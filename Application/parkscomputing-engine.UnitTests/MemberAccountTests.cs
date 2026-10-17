using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using ParksComputing.Engine.Identity;
namespace ParksComputing.Engine.UnitTests;
[TestClass]
public class MemberAccountTests {
    private sealed class Mail : HttpMessageHandler {
        public readonly List<string> Texts = new();
        public bool Fail;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) {
            using var doc = JsonDocument.Parse(await request.Content.ReadAsStringAsync());
            Texts.Add(doc.RootElement.GetProperty("text").GetString());
            return new HttpResponseMessage(Fail ? HttpStatusCode.ServiceUnavailable : HttpStatusCode.OK);
        }
    }
    [TestMethod, TestCategory("SQLServer")]
    public async Task RegistrationVerificationMemberSignInProfileAndRevocationWorkThroughHttp() {
        string connection = Environment.GetEnvironmentVariable("PARKSCOMPUTING_PUBLISHING_TEST_SQL");
        if (string.IsNullOrEmpty(connection)) { Assert.Inconclusive("An isolated SQL fixture is required."); }
        var parsed = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(connection);
        if (parsed.InitialCatalog != "parkscomputing_publishing_tests") { Assert.Fail("Unexpected fixture database."); }
        parsed.InitialCatalog += "_members";
        var directory = Path.Combine(Path.GetTempPath(), "pc-members-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(directory, "wwwroot", "content"));
        var mail = new Mail();
        using var host = new HostBuilder().ConfigureAppConfiguration(c => c.AddInMemoryCollection(new Dictionary<string,string> {
            ["Auth:ConnectionString"] = parsed.ConnectionString, ["Accounts:Enabled"] = "true",
            ["Accounts:Origin"] = "https://beta.example.test", ["Accounts:StaffEnabled"] = "true", ["Accounts:Registration"] = "true", ["Admin:HomeRoot"] = directory + "/home",
            ["Admin:EtcRoot"] = directory + "/etc", ["Admin:HistoryRoot"] = directory + "/history",
            ["RESEND_API_KEY"] = "fixture", ["EMAIL_FROM"] = "site@example.test", ["CommentService:ApiUrl"] = "http://unused.localhost"
        })).ConfigureWebHost(web => web.UseTestServer().UseEnvironment("Production").UseContentRoot(directory).UseWebRoot("wwwroot")
            .UseStartup<Startup>().ConfigureTestServices(services => services.AddHttpClient(ResendMailer.ClientName).ConfigurePrimaryHttpMessageHandler(() => mail))).Build();
        try {
            using (var scope = host.Services.CreateScope()) {
                var db = scope.ServiceProvider.GetRequiredService<SiteIdentityDbContext>();
                await db.Database.EnsureDeletedAsync(); await db.Database.MigrateAsync();
            }
            await host.StartAsync(); using var client = host.GetTestClient(); client.BaseAddress = new Uri("https://beta.example.test");
            var cookies = new Dictionary<string,string>();
            async Task<HttpResponseMessage> Send(HttpMethod method, string url, Dictionary<string,string> form = null) {
                using var request = new HttpRequestMessage(method,url);
                if (cookies.Count > 0) { request.Headers.Add("Cookie", string.Join("; ",cookies.Values)); }
                if (form is not null) { request.Content = new FormUrlEncodedContent(form); }
                var response = await client.SendAsync(request);
                if (response.Headers.TryGetValues("Set-Cookie",out var values)) { foreach (var value in values) {
                    var cookie=value.Split(';')[0]; cookies[cookie.Split('=')[0]]=cookie;
                }}
                return response;
            }
            async Task<Dictionary<string,string>> Form(string url) {
                using var page = await Send(HttpMethod.Get,url); Assert.AreEqual(HttpStatusCode.OK,page.StatusCode);
                var html=await page.Content.ReadAsStringAsync();
                var fields = new Dictionary<string,string>();
                foreach (Match input in Regex.Matches(html,"<input[^>]*>")) {
                    var name=Regex.Match(input.Value,"name=\"([^\"]+)\""); var value=Regex.Match(input.Value,"value=\"([^\"]*)\"");
                    if (name.Success && value.Success) { fields[WebUtility.HtmlDecode(name.Groups[1].Value)]=WebUtility.HtmlDecode(value.Groups[1].Value); }
                }
                Assert.IsTrue(fields.ContainsKey("__RequestVerificationToken")); return fields;
            }
            string LastLink() => Regex.Match(mail.Texts.Last(),"https://[^\\s]+").Value;
            // The site with accounts reads like the public site; only the old
            // edit-origin workspace does not exist on it.
            using(var admin=await Send(HttpMethod.Get,"/admin/editor")) { Assert.AreEqual(HttpStatusCode.NotFound,admin.StatusCode); }
            using(var relay=await Send(HttpMethod.Get,"/api/admin/ssh/relay")) { Assert.AreEqual(HttpStatusCode.NotFound,relay.StatusCode); }
            var form=await Form("/account/register"); form["Email"]="member+test@example.test"; form["DisplayName"]="<b>Original name</b>"; form["Role"]="SuperAdmin";
            using(var refused=await Send(HttpMethod.Post,"/account/register",new Dictionary<string,string>{{"Email",form["Email"]},{"DisplayName",form["DisplayName"]}})) { Assert.AreEqual(HttpStatusCode.BadRequest,refused.StatusCode); }
            using(var response=await Send(HttpMethod.Post,"/account/register",form)) { Assert.AreEqual(HttpStatusCode.OK,response.StatusCode); }
            var firstLink=LastLink(); string userId;
            using(var scope=host.Services.CreateScope()) {
                var db=scope.ServiceProvider.GetRequiredService<SiteIdentityDbContext>(); var user=await db.Users.SingleAsync(); userId=user.Id;
                Assert.IsFalse(user.EmailConfirmed); Assert.AreEqual(0,await db.UserRoles.CountAsync());
            }
            form=await Form("/account/register"); form["Email"]="MEMBER+TEST@example.test"; form["DisplayName"]="Overwrite attempt";
            using(var response=await Send(HttpMethod.Post,"/account/register",form)) { Assert.AreEqual(HttpStatusCode.OK,response.StatusCode); }
            var secondLink=LastLink();
            using(var superseded=await Send(HttpMethod.Get,firstLink)) { StringAssert.Contains(await superseded.Content.ReadAsStringAsync(),"This link has already been used or has expired"); }
            form=await Form(secondLink); using(var verified=await Send(HttpMethod.Post,"/account/link",form)) { Assert.AreEqual(HttpStatusCode.Redirect,verified.StatusCode); }
            var signedCookie=cookies["__Host-pc-account"];
            using(var account=await Send(HttpMethod.Get,"/account")) {
                var html=await account.Content.ReadAsStringAsync(); StringAssert.Contains(html,"&lt;b&gt;Original name&lt;/b&gt;");
                Assert.IsTrue(account.Headers.CacheControl.NoStore);
            }
            using(var scope=host.Services.CreateScope()) {
                var users=scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>(); var user=await users.FindByIdAsync(userId);
                Assert.IsTrue(user.EmailConfirmed); CollectionAssert.AreEquivalent(new[]{"Member"},(await users.GetRolesAsync(user)).ToArray());
                var db=scope.ServiceProvider.GetRequiredService<SiteIdentityDbContext>(); Assert.AreEqual(1,await db.SiteSessions.CountAsync());
            }
            using(var denied=await Send(HttpMethod.Get,"/api/admin/editor/shortcodes")) { Assert.AreEqual(HttpStatusCode.NotFound,denied.StatusCode); }
            using(var replay=await Send(HttpMethod.Post,"/account/link",form)) { Assert.AreEqual(HttpStatusCode.BadRequest,replay.StatusCode); }
            form=await Form("/account"); form["DisplayName"]="Renamed";
            using(var saved=await Send(HttpMethod.Post,"/account?handler=Profile",form)) { Assert.AreEqual(HttpStatusCode.Redirect,saved.StatusCode); }
            using(var stale=await Send(HttpMethod.Post,"/account?handler=Profile",form)) { StringAssert.Contains(await stale.Content.ReadAsStringAsync(),"Reload, then save again"); }
            form=await Form("/account"); using(var outResponse=await Send(HttpMethod.Post,"/account/signout",form)) { Assert.AreEqual(HttpStatusCode.Redirect,outResponse.StatusCode); }
            cookies["__Host-pc-account"]=signedCookie;
            // A revoked cookie signs nobody in: /account shows its signed-out view.
            using(var replayCookie=await Send(HttpMethod.Get,"/account")) {
                var html=await replayCookie.Content.ReadAsStringAsync();
                StringAssert.Contains(html,"not signed in"); Assert.IsFalse(html.Contains("Renamed"));
            }
            // Signing in from the window view comes back to it: the link carries the place.
            form=await Form("/account/signin"); form["Email"]="member+test@example.test"; form["returnUrl"]="/?view=window&open=about";
            using(var request=await Send(HttpMethod.Post,"/account/signin",form)) { Assert.AreEqual(HttpStatusCode.OK,request.StatusCode); }
            StringAssert.Contains(LastLink(),"&return=%2F%3Fview%3Dwindow%26open%3Dabout");
            form=await Form(LastLink()); using(var signIn=await Send(HttpMethod.Post,"/account/link",form)) {
                Assert.AreEqual(HttpStatusCode.Redirect,signIn.StatusCode); Assert.AreEqual("/?view=window&open=about",signIn.Headers.Location!.ToString());
            }
            // A second browser can be revoked only by its owner.
            using(var scope=host.Services.CreateScope()) {
                var sessions=scope.ServiceProvider.GetRequiredService<DurableSessions>(); var users=scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
                var secondSession=await sessions.CreateAsync(await users.FindByIdAsync(userId),AdminSessions.EmailLink);
                form=await Form("/account"); form["sessionId"]=secondSession;
                using(var revoked=await Send(HttpMethod.Post,"/account?handler=Revoke",form)) { Assert.AreEqual(HttpStatusCode.Redirect,revoked.StatusCode); }
                var db=scope.ServiceProvider.GetRequiredService<SiteIdentityDbContext>(); Assert.IsNotNull((await db.SiteSessions.SingleAsync(s=>s.Id==secondSession)).RevokedUtc);
            }
            form=await Form("/account"); using(var outResponse=await Send(HttpMethod.Post,"/account/signout",form)) { Assert.AreEqual(HttpStatusCode.Redirect,outResponse.StatusCode); }
            mail.Fail=true; form=await Form("/account/signin"); form["Email"]="member+test@example.test";
            using(var failed=await Send(HttpMethod.Post,"/account/signin",form)) { Assert.AreEqual(HttpStatusCode.OK,failed.StatusCode); }
            using(var link=await Send(HttpMethod.Get,LastLink())) { StringAssert.Contains(await link.Content.ReadAsStringAsync(),"This link has already been used or has expired"); }
            mail.Fail=false;
            var workflow=host.Services.GetRequiredService<AccountWorkflow>();
            var before=mail.Texts.Count;
            await workflow.RequestAsync("quota@example.test","Quota","other-ip");
            for(int i=0;i<7;i++) { await workflow.RequestAsync("quota@example.test",null,"other-ip"); }
            Assert.AreEqual(before+5,mail.Texts.Count);
            await workflow.RequestAsync("quota@example.test",null,"different-ip"); Assert.AreEqual(before+5,mail.Texts.Count);
            // Host authorization cannot grant privileges before verification and two passkeys.
            Assert.AreEqual(0,await StaffBootstrap.RunAsync(host.Services,new[]{"account-bootstrap","staff@example.test","Staff"}));
            using(var scope=host.Services.CreateScope()) {
                var users=scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>(); var staff=await users.FindByEmailAsync("staff@example.test");
                Assert.IsFalse(staff.EmailConfirmed); Assert.AreEqual(0,(await users.GetRolesAsync(staff)).Count);
            }
            await workflow.RequestAsync("staff@example.test",null,"staff-fixture");
            var url=new Uri(LastLink()); var query=Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(url.Query);
            var redeemed=await workflow.RedeemAsync(query["uid"],AccountLinkPurpose.VerifyEmail,query["token"]); Assert.IsNotNull(redeemed);
            string staffId=redeemed.Value.UserId;
            var sid=await host.Services.GetRequiredService<DurableSessions>().CreateAsync(new IdentityUser{Id=staffId},AdminSessions.Passkey);
            var principal=new ClaimsPrincipal(new ClaimsIdentity(new[]{new Claim(ClaimTypes.NameIdentifier,staffId),new Claim(AdminSessions.SessionClaim,sid)},"fixture"));
            var bootstrap=host.Services.GetRequiredService<StaffBootstrap>();
            Assert.IsFalse(await bootstrap.ActivateAsync(principal));
            using(var scope=host.Services.CreateScope()) {
                var db=scope.ServiceProvider.GetRequiredService<SiteIdentityDbContext>();
                for(int i=0;i<2;i++) {
                    db.Set<IdentityUserPasskey<string>>().Add(new IdentityUserPasskey<string>{UserId=staffId,CredentialId=Guid.NewGuid().ToByteArray(),Data=new IdentityPasskeyData {
                        PublicKey=new byte[]{1},AttestationObject=new byte[]{1},ClientDataJson=new byte[]{1},CreatedAt=DateTimeOffset.UtcNow,IsUserVerified=true
                    }});
                    await db.SaveChangesAsync(); if(i==0) { Assert.IsFalse(await bootstrap.ActivateAsync(principal)); }
                }
            }
            Assert.IsTrue(await bootstrap.ActivateAsync(principal));
            Assert.IsFalse(await host.Services.GetRequiredService<SessionPolicy>().ValidAsync(principal));
            using(var scope=host.Services.CreateScope()) {
                var users=scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
                CollectionAssert.AreEquivalent(new[]{"Member","Admin","SuperAdmin"},(await users.GetRolesAsync(await users.FindByIdAsync(staffId))).ToArray());
            }
            await workflow.RequestAsync("staff@example.test",null,"staff-fixture");
            form=await Form(LastLink()); using(var signed=await Send(HttpMethod.Post,"/account/link",form)) { Assert.AreEqual(HttpStatusCode.Redirect,signed.StatusCode); }
            // The super-user's tools read without a passkey tap, but a destructive one waits for it.
            using(var tools=await Send(HttpMethod.Get,"/api/admin/editor/shortcodes")) { Assert.AreEqual(HttpStatusCode.OK,tools.StatusCode); }
            async Task<HttpResponseMessage> Fs(string action, string path) {
                string token;
                using(var ask=new HttpRequestMessage(HttpMethod.Get,"/api/account/token")) {
                    ask.Headers.Add("Cookie",string.Join("; ",cookies.Values)); ask.Headers.Add("Accept","application/json");
                    using var t=await client.SendAsync(ask);
                    if (t.Headers.TryGetValues("Set-Cookie",out var values)) { foreach (var value in values) { var cookie=value.Split(';')[0]; cookies[cookie.Split('=')[0]]=cookie; } }
                    token=System.Text.Json.JsonDocument.Parse(await t.Content.ReadAsStringAsync()).RootElement.GetProperty("token").GetString();
                }
                using var request=new HttpRequestMessage(HttpMethod.Post,"/api/admin/fs/"+action);
                request.Headers.Add("Cookie",string.Join("; ",cookies.Values)); request.Headers.Add("RequestVerificationToken",token);
                request.Content=new StringContent(System.Text.Json.JsonSerializer.Serialize(new{root="home",path}),System.Text.Encoding.UTF8,"application/json");
                return await client.SendAsync(request);
            }
            using(var made=await Fs("mkdir","probe")) { Assert.AreEqual(HttpStatusCode.OK,made.StatusCode,await made.Content.ReadAsStringAsync()); }
            using(var unconfirmed=await Fs("delete","probe")) { Assert.AreEqual(HttpStatusCode.Forbidden,unconfirmed.StatusCode); }
            // The browser fixture independently tests real assertions. Mark this HTTP fixture's staff session confirmed.
            using(var scope=host.Services.CreateScope()) {
                var db=scope.ServiceProvider.GetRequiredService<SiteIdentityDbContext>();
                await db.SiteSessions.Where(s=>s.UserId==staffId&&s.RevokedUtc==null).ExecuteUpdateAsync(s=>s.SetProperty(x=>x.ConfirmedUtc,(DateTime?)DateTime.UtcNow));
            }
            using(var confirmed=await Fs("delete","probe")) { Assert.AreEqual(HttpStatusCode.OK,confirmed.StatusCode); }
        } finally { await host.StopAsync(); Directory.Delete(directory,recursive:true); }
    }
}
