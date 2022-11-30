using System;
using System.Net.Http;

using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

using System.Text.Json;
using System.Text.Json.Serialization;
using System.Collections.Generic;

namespace aspnet_core_dotnet_core.Pages {
    public class wpModel : PageModel {

        public string WpContent { get; set; }

        public void OnGet() {
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
                            string json = response.Content.ReadAsStringAsync().Result;
                            var cvt = JsonSerializer.Deserialize<object>(json);
                            JsonElement array = (JsonElement) cvt;
                            WpContent = array[0].GetProperty("content").GetProperty("rendered").GetString();
                            return;
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

            WpContent = $"<p>List of posts here</p>";
        }
    }
}
