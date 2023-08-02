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

        // private static Dictionary<string, List<Comment>> PageComments { get; set; } = new Dictionary<string, List<Comment>>();
        private static Dictionary<string, Dictionary<string, Comment>> PageComments = new Dictionary<string, Dictionary<string, Comment>>();

        [Function("Comments")]
        public HttpResponseData Run([HttpTrigger(AuthorizationLevel.Function, "get")] HttpRequestData req) {
            _logger.LogInformation("C# HTTP trigger function processed a request for a list of comments.");
            string? domain = req.Query["domain"];
            string? pageId = req.Query["pageId"];

            if (string.IsNullOrEmpty(domain) || string.IsNullOrEmpty(pageId)) {
                var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                errorResponse.WriteString("Invalid input: Domain and PageId are required");
                return errorResponse;
            }

            string key = $"{domain}_{pageId}";
            List<Comment> commentList;

            lock (PageComments) {
                if (PageComments.ContainsKey(key)) {
                    commentList = PageComments[key].Values.ToList<Comment>();
                }
                else {
                    commentList = new List<Comment>(); // Return an empty list if no comments are found
                }
            }

            var response = req.CreateResponse(HttpStatusCode.OK);
            response.Headers.Add("Content-Type", "application/json; charset=utf-8");
            response.WriteString(JsonSerializer.Serialize(commentList));

            return response;
        }

        [Function("Comment")]
        public HttpResponseData Comment([HttpTrigger(AuthorizationLevel.Function, "get", "put", "post", "delete")] HttpRequestData req, FunctionContext executionContext) {
            _logger.LogInformation("Comment");

            switch (req.Method.ToUpper()) {
                case "GET":
                    return GetComment(req);

                case "POST":
                    return PostComment(req);

                case "PUT":
                    return PutComment(req);

                case "DELETE":
                    return DeleteComment(req);
            }

            return req.CreateResponse(HttpStatusCode.NotImplemented);
        }


        private HttpResponseData GetComment(HttpRequestData req) {
            _logger.LogInformation("Get a comment");
            string? domain = req.Query["domain"];
            string? pageId = req.Query["pageId"];
            string? commentId = req.Query["commentId"];

            if (string.IsNullOrEmpty(domain) || string.IsNullOrEmpty(pageId) || string.IsNullOrEmpty(commentId)) {
                var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                errorResponse.WriteString("Invalid input: Either a commentId or a domain and a pageId are required");
                return errorResponse;
            }

            string key = $"{domain}_{pageId}";

            lock (PageComments) {
                if (PageComments.ContainsKey(key) && PageComments[key].ContainsKey(commentId)) {
                    Comment comment = PageComments[key][commentId];
                    var response = req.CreateResponse(HttpStatusCode.OK);
                    response.Headers.Add("Content-Type", "application/json; charset=utf-8");
                    response.WriteString(JsonSerializer.Serialize(comment));
                    return response;
                }
                else {
                    return req.CreateResponse(HttpStatusCode.NotFound); // Return 404 if no comment is found
                }
            }
        }

        private HttpResponseData PostComment(HttpRequestData req) {
            _logger.LogInformation("Post a comment");
            string? requestBody = req.ReadAsStringAsync().Result;

            if (requestBody is null) {
                var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                errorResponse.WriteString("Invalid input");
                return errorResponse;
            }

            Comment? newComment = JsonSerializer.Deserialize<Comment>(requestBody);

            if (newComment is null) {
                var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                errorResponse.WriteString("Invalid comment data");
                return errorResponse;
            }

            var domain = newComment.Domain;
            var pageId = newComment.PageId;
            string key = $"{domain}_{pageId}";

            // Generate a unique ID for the comment
            newComment.CommentId = Guid.NewGuid().ToString();

            // Lock the dictionaries while updating to ensure thread-safety
            lock (PageComments) {
                if (!PageComments.ContainsKey(key)) {
                    PageComments[key] = new Dictionary<string, Comment>();
                }

                PageComments[key][newComment.CommentId] = newComment;
            }

            // Create a response
            var response = req.CreateResponse(HttpStatusCode.Created);
            response.Headers.Add("Content-Type", "application/json; charset=utf-8");
            response.WriteString(JsonSerializer.Serialize(newComment));

            return response;
        }

        public HttpResponseData PutComment(HttpRequestData req) {
            _logger.LogInformation("Put a comment");
            string? requestBody = req.ReadAsStringAsync().Result;

            if (requestBody is null) {
                var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                errorResponse.WriteString("Invalid input");
                return errorResponse;
            }

            Comment? updatedComment = JsonSerializer.Deserialize<Comment>(requestBody);

            if (updatedComment is null) {
                var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                errorResponse.WriteString("Invalid comment data");
                return errorResponse;
            }

            if (string.IsNullOrEmpty(updatedComment.CommentId)) {
                var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                errorResponse.WriteString("Invalid comment data");
                return errorResponse;
            }

            string key = $"{updatedComment.Domain}_{updatedComment.PageId}";
            string commentId = updatedComment.CommentId;

            lock (PageComments) {
                if (PageComments.ContainsKey(key) && PageComments[key].ContainsKey(commentId)) {
                    PageComments[key][commentId] = updatedComment;
                    var response = req.CreateResponse(HttpStatusCode.OK);
                    response.Headers.Add("Content-Type", "application/json; charset=utf-8");
                    response.WriteString(JsonSerializer.Serialize(updatedComment));
                    return response;
                }
                else {
                    return req.CreateResponse(HttpStatusCode.NotFound);
                }
            }
        }

        private HttpResponseData DeleteComment(HttpRequestData req) {
            _logger.LogInformation("Delete a comment");
            string? domain = req.Query["domain"];
            string? pageId = req.Query["pageId"];
            string? commentId = req.Query["commentId"];

            if (string.IsNullOrEmpty(domain) || string.IsNullOrEmpty(pageId) || string.IsNullOrEmpty(commentId)) {
                var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                errorResponse.WriteString("Invalid input: Domain, PageId, and CommentId are required");
                return errorResponse;
            }

            string key = $"{domain}_{pageId}";

            lock (PageComments) {
                if (PageComments.ContainsKey(key) && PageComments[key].ContainsKey(commentId)) {
                    PageComments[key].Remove(commentId);

                    // Optionally, you can remove the key if there are no more comments
                    if (PageComments[key].Count == 0) {
                        PageComments.Remove(key);
                    }
                }
                else {
                    return req.CreateResponse(HttpStatusCode.NotFound);
                }
            }

            return req.CreateResponse(HttpStatusCode.NoContent); // Return NoContent (204) status to indicate success
        }
    }
}
