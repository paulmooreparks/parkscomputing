using System.Net;
using System.Text.Json;

using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

using SmartSam.Comments.Lib;

namespace SmartSam.Comments.Service {
    public class Comments {
        private readonly ILogger _logger;

        public Comments(ILoggerFactory loggerFactory) {
            _logger = loggerFactory.CreateLogger<Comments>();
        }

        [Function("Comments")]
        public HttpResponseData Run([HttpTrigger(AuthorizationLevel.Function, "get")] HttpRequestData req) {
            _logger.LogInformation("C# HTTP trigger function processed a request for a list of comments.");
            string? domain = req.Query["domain"];
            string? pageId = req.Query["pageId"];

            List<Comment> commentList = new List<Comment>() {
                new Comment {
                    PageId = pageId,
                    Domain = domain,
                    Id = "1",
                    CreateDateTime = DateTime.Parse("15 December 2022 10:54"),
                    Name = "Paul",
                    Email = "paul@smartsam.com",
                    Title = "Hello, World",
                    CommentText = "Hi there!"
                },
                new Comment {
                    PageId = pageId,
                    Domain = domain,
                    Id = "2",
                    CreateDateTime = DateTime.Parse("15 December 2022 10:54"),
                    Name = "Larry",
                    Email = "larry@smartsam.com",
                    Title = "Whee dog!",
                    CommentText = "Gitrdone!"
                }
            };

            var response = req.CreateResponse(HttpStatusCode.OK);
            response.Headers.Add("Content-Type", "application/json; charset=utf-8");

            response.WriteString(JsonSerializer.Serialize(commentList));

            return response;
        }

        [Function("Comment")]
        public HttpResponseData Comment([HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequestData req, FunctionContext executionContext) {
            _logger.LogInformation("C# HTTP trigger function processed a request to add a comment.");

            // Read the request body and deserialize it into a Comment object
            string? requestBody = req.ReadAsStringAsync().Result;

            if (requestBody is null) {
                var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                errorResponse.WriteString("Invalid input");
                return errorResponse;
            }

            Comment? newComment = JsonSerializer.Deserialize<Comment>(requestBody);

            // Validate the input (you'll want to expand on this to suit your needs)
            if (string.IsNullOrEmpty(newComment?.PageId) || string.IsNullOrEmpty(newComment.Name) || string.IsNullOrEmpty(newComment.CommentText)) {
                var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                errorResponse.WriteString("Invalid input");
                return errorResponse;
            }

            // TODO: Add code here to save the comment to your database or other persistent storage

            // Create a response
            var response = req.CreateResponse(HttpStatusCode.Created);
            response.Headers.Add("Content-Type", "application/json; charset=utf-8");
            response.WriteString(JsonSerializer.Serialize(newComment));

            return response;
        }

    }
}
