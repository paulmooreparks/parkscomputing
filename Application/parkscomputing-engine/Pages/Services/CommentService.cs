using System;
using System.Collections.Generic;
using SmartSam.Comments.Lib;
using Microsoft.Extensions.Hosting;
using System.Net.Http;
using System.Threading.Tasks;
using System.Text.Json;
using Newtonsoft.Json;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Pages.Services {
    public class CommentService : ICommentService {
        private IOptions<CommentServiceConfig> CommentServiceConfig { get; }
        private HttpClient HttpClient { get; }

        public CommentService(IHttpClientFactory clientFactory, IOptions<CommentServiceConfig> commentServiceConfig) {
            HttpClient = clientFactory.CreateClient("commentApi");
            CommentServiceConfig = commentServiceConfig;
        }

        async Task<Comments> ICommentService.GetCommentsAsync(string pageId, bool commentsEnabled, bool commentsAllowed, bool commentPosted) {
            var domain = CommentServiceConfig.Value.Domain;
            var commentResponses = new List<CommentResponse>();
            Exception? exception = null;

            if (commentsEnabled) {
                try {
                    var response = await HttpClient.GetAsync($"/api/comments/{domain}/{pageId}");

                    if (response.IsSuccessStatusCode) {
                        var content = await response.Content.ReadAsStringAsync();
                        commentResponses = JsonConvert.DeserializeObject<List<CommentResponse>>(content);
                    }
                }
                catch (Exception ex) {
                    exception = ex;
                }
            }

            // handle error response or throw an exception based on your requirement
            return new Comments {
                Enabled = commentsEnabled,
                Allowed = commentsAllowed,
                Posted = commentPosted,
                Exception = exception,
                CommentResponseList = commentResponses!
            };
        }
    }
}
