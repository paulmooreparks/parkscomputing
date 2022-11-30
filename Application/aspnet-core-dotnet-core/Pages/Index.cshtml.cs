using System;
using System.Collections.Generic;
using System.Linq;
using System.Globalization;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;

using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace aspnet_core_dotnet_core.Pages {
    public class IndexModel : PageModel {
        public string WpTitle { get; set; }
        public string WpContent { get; set; }
        public string WpCreatedGmt { get; set; }
        public string WpModifiedGmt { get; set; }
        public string WpCreated { get; set; }
        public string WpModified { get; set; }
        public string WpLink { get; set; }
        public string WpSlug { get; set; }

        public async Task<IActionResult> OnGetAsync() {
            object slugObject = HttpContext.Request.RouteValues["slug"];

            if (slugObject is not null) {
                // /post/set-associative-cache-in-c-part-2-interface-design
                string Baseurl = $"https://www.parkscomputing.com/wp-json/wp/v2/posts?slug={slugObject.ToString()}";

                try {
                    using (var client = new HttpClient()) {
                        HttpRequestMessage request = new HttpRequestMessage();
                        request.RequestUri = new Uri(Baseurl);
                        request.Method = HttpMethod.Get;
                        // request.Headers.Add("SecureApiKey", "12345");
                        HttpResponseMessage response = client.Send(request);
                        var responseString = response.Content.ReadAsStringAsync();
                        var statusCode = response.StatusCode;

                        if (response.IsSuccessStatusCode) {
                            string json = await response.Content.ReadAsStringAsync();
                            var cvt = JsonSerializer.Deserialize<object>(json);
                            JsonElement array = (JsonElement)cvt;
                            WpCreatedGmt = array[0].GetProperty("date_gmt").GetString();
                            WpModifiedGmt = array[0].GetProperty("modified_gmt").GetString();
                            WpLink = array[0].GetProperty("link").GetString();

                            var createDate = DateTime.ParseExact(WpCreatedGmt, "s", DateTimeFormatInfo.InvariantInfo);
                            var modDate = DateTime.ParseExact(WpModifiedGmt, "s", DateTimeFormatInfo.InvariantInfo);
                            WpCreated = createDate.ToLongDateString();
                            WpModified = modDate.ToLongDateString();

                            WpTitle = array[0].GetProperty("title").GetProperty("rendered").GetString();
                            WpContent = array[0].GetProperty("content").GetProperty("rendered").GetString();
                        }

                        else {
                            //API Call Failed, Check Error Details
                        }
                    }
                }
                catch (Exception) {

                    throw;
                }
            }

            // WpContent = $"<p>List of posts here</p>";
            return Page();
        }
        public string DoTest() {
            return "Index";
        }
    }
}