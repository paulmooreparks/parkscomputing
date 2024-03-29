using System;
using System.Net.Http;

using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

using System.Text.Json;
using System.Text.Json.Serialization;
using System.Collections.Generic;
using System.Globalization;
using System.Threading.Tasks;
using System.Reflection;

namespace aspnet_core_dotnet_core.Pages {
    public class PostLoaderModel : PageModel {

        public string? WpTitle { get; set; }
        public string? WpContent { get; set; }
        public string? WpCreatedGmt { get; set; }
        public string? WpModifiedGmt { get; set; }
        public string? WpCreated { get; set; }
        public string? WpModified { get; set; }
        public string? WpLink { get; set; }
        public string? WpSlug { get; set; }
        public string? WpJson { get; set; }

        public async Task<IActionResult> OnGetAsync() {
            object slugObject = HttpContext.Request.RouteValues["slug"]!;
            string Baseurl = $"https://www.parkscomputing.com/wp-json/wp/v2/posts?slug={slugObject.ToString()}";

            try {
                using (var client = new HttpClient()) {
                    HttpRequestMessage request = new HttpRequestMessage();
                    request.RequestUri = new Uri(Baseurl);
                    request.Method = HttpMethod.Get;
                    // request.Headers.Add("SecureApiKey", "12345");
                    HttpResponseMessage response = await client.SendAsync(request);
                    var responseString = response.Content.ReadAsStringAsync();
                    var statusCode = response.StatusCode;

                    if (response.IsSuccessStatusCode) {
                        string json = await response.Content.ReadAsStringAsync();
                        var cvt = JsonSerializer.Deserialize<object>(json);
                        JsonElement array = (JsonElement)cvt!;
                        WpCreatedGmt = array[0].GetProperty("date_gmt").GetString()!;
                        WpModifiedGmt = array[0].GetProperty("modified_gmt").GetString()!;

                        var createDate = DateTime.ParseExact(WpCreatedGmt, "s", DateTimeFormatInfo.InvariantInfo);
                        var modDate = DateTime.ParseExact(WpModifiedGmt, "s", DateTimeFormatInfo.InvariantInfo);
                        WpCreated = createDate.ToLongDateString();
                        WpModified = modDate.ToLongDateString();

                        var link = array[0].GetProperty("link").GetString();
                        var linkUri = new Uri(link!);
                        WpLink = linkUri.PathAndQuery;

                        WpTitle = array[0].GetProperty("title").GetProperty("rendered").GetString()!;
                        WpContent = array[0].GetProperty("content").GetProperty("rendered").GetString()!;

                        // Url
                    }
                    else {
                        //API Call Failed, Check Error Details
                    }
                }
            }
            catch (Exception) {
                throw;
            }

            return Page();
        }
    }
}
