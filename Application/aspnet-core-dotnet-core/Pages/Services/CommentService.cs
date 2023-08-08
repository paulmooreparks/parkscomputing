using System;
using System.Collections.Generic;
using SmartSam.Comments.Lib;
using Microsoft.Extensions.Hosting;
using System.Net.Http;
using System.Threading.Tasks;
using System.Text.Json;
using Newtonsoft.Json;

namespace aspnet_core_dotnet_core.Pages.Services {
    public class CommentService : ICommentService {
        private HttpClient HttpClient { get; }

        public CommentService(IHttpClientFactory clientFactory) {
            HttpClient = clientFactory.CreateClient("commentApi");
        }

        async Task<Comments> ICommentService.GetCommentsAsync(string pageId, bool commentsEnabled, bool commentsAllowed) {
            var domain = "barn.parkscomputing.com";

            var response = await HttpClient.GetAsync($"/api/comments/{domain}/{pageId}");

            if (response.IsSuccessStatusCode) {
                var content = await response.Content.ReadAsStringAsync();
                // var commentResponses = JsonSerializer.Deserialize<List<CommentResponse>>(content);
                var commentResponses = JsonConvert.DeserializeObject<List<CommentResponse>>(content);

                return new Comments {
                    Enabled = commentsEnabled,
                    Allowed = commentsAllowed,
                    CommentResponseList = commentResponses
                };
            }

            // handle error response or throw an exception based on your requirement
            return null;
        }
    }
}
