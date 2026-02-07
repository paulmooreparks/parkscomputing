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

namespace ParksComputing.Engine.Pages {
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
            // Safely obtain slug from route values
            if (!HttpContext.Request.RouteValues.TryGetValue("slug", out var slugObj) || slugObj is null) {
                return NotFound(); // No slug route value
            }

            var slug = slugObj.ToString()?.Trim();
            
            if (string.IsNullOrEmpty(slug)) {
                return NotFound();
            }

            string baseUrl = $"https://www.parkscomputing.com/wp-json/wp/v2/posts?slug={Uri.EscapeDataString(slug)}";

            try {
                using var client = new HttpClient();
                var response = await client.GetAsync(baseUrl);

                if (!response.IsSuccessStatusCode) {
                    // Upstream WP API failure or slug not found
                    return NotFound();
                }

                var json = await response.Content.ReadAsStringAsync();
                JsonDocument doc;
                try {
                    doc = JsonDocument.Parse(json);
                }
                catch {
                    return StatusCode(502);
                } // Invalid JSON from upstream

                var root = doc.RootElement;

                if (root.ValueKind != JsonValueKind.Array || root.GetArrayLength() == 0) {
                    return NotFound(); // No post returned for slug
                }

                var post = root[0];

                // Defensive property extraction
                if (post.TryGetProperty("date_gmt", out var dateGmt)) {
                    WpCreatedGmt = dateGmt.GetString();
                }

                if (post.TryGetProperty("modified_gmt", out var modifiedGmt)) {
                    WpModifiedGmt = modifiedGmt.GetString();
                }

                if (!string.IsNullOrEmpty(WpCreatedGmt) && DateTime.TryParseExact(WpCreatedGmt, "s", DateTimeFormatInfo.InvariantInfo, DateTimeStyles.None, out var createDate)) {
                    WpCreated = createDate.ToLongDateString();
                }

                if (!string.IsNullOrEmpty(WpModifiedGmt) && DateTime.TryParseExact(WpModifiedGmt, "s", DateTimeFormatInfo.InvariantInfo, DateTimeStyles.None, out var modDate)) {
                    WpModified = modDate.ToLongDateString();
                }

                if (post.TryGetProperty("link", out var linkProp)) {
                    var linkStr = linkProp.GetString();
                    if (!string.IsNullOrEmpty(linkStr) && Uri.TryCreate(linkStr, UriKind.Absolute, out var linkUri)) {
                        WpLink = linkUri.PathAndQuery;
                    }
                }

                if (post.TryGetProperty("title", out var titleProp) && titleProp.TryGetProperty("rendered", out var titleRendered)) {
                    WpTitle = titleRendered.GetString();
                }

                if (post.TryGetProperty("content", out var contentProp) && contentProp.TryGetProperty("rendered", out var contentRendered)) {
                    WpContent = contentRendered.GetString();
                }
            }
            catch (HttpRequestException) {
                return StatusCode(503); // Upstream temporary issue
            }
            catch (Exception) {
                // Let higher middleware handle unexpected errors
                throw;
            }

            return Page();
        }
    }
}
