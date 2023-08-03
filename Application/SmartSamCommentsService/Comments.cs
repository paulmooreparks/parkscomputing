using System.Net;
using System.Text.Json;

using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

using SmartSam.Comments.Data;
using SmartSam.Comments.Lib;

namespace SmartSam.Comments.Service {
    public class Comments {
        private readonly ILogger _logger;
        private readonly AppDbContext _context;

        public Comments(ILoggerFactory loggerFactory, AppDbContext context) {
            _logger = loggerFactory.CreateLogger<Comments>();
            _context = context;
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

            // Query the comment based on the provided parameters
            var comment = _context.Comments
                .Include(c => c.User) // Assuming a navigation property to the user
                .FirstOrDefault(c => c.Domain == domain && c.PageId == pageId && c.CommentId == commentId);

            if (comment != null) {
                var response = req.CreateResponse(HttpStatusCode.OK);
                response.Headers.Add("Content-Type", "application/json; charset=utf-8");
                response.WriteString(JsonSerializer.Serialize(comment));
                return response;
            }
            else {
                return req.CreateResponse(HttpStatusCode.NotFound); // Return 404 if no comment is found
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

            // Generate a unique ID for the comment
            newComment.CommentId = Guid.NewGuid().ToString();
            newComment.CreateDateTime = DateTime.Now;
            newComment.Status = CommentStatus.AwaitingModeration;

            _context.Comments.Add(newComment);
            _context.SaveChanges();

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

            var existingComment = _context.Comments.Find(updatedComment.CommentId);

            if (existingComment != null) {
                // Update the existing comment with the new data
                _context.Entry(existingComment).CurrentValues.SetValues(updatedComment);
                _context.SaveChanges();

                var response = req.CreateResponse(HttpStatusCode.OK);
                response.Headers.Add("Content-Type", "application/json; charset=utf-8");
                response.WriteString(JsonSerializer.Serialize(updatedComment));
                return response;
            }
            else {
                return req.CreateResponse(HttpStatusCode.NotFound);
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

            var commentToDelete = _context.Comments
                .FirstOrDefault(c => c.Domain == domain && c.PageId == pageId && c.CommentId == commentId);

            if (commentToDelete != null) {
                _context.Comments.Remove(commentToDelete);
                _context.SaveChanges();
            }
            else {
                return req.CreateResponse(HttpStatusCode.NotFound);
            }

            return req.CreateResponse(HttpStatusCode.NoContent); // Return NoContent (204) status to indicate success
        }

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

            var commentList = _context.Comments.Include(c => c.User).Where(c => c.Domain == domain && c.PageId == pageId).ToList();

            var response = req.CreateResponse(HttpStatusCode.OK);
            response.Headers.Add("Content-Type", "application/json; charset=utf-8");
            response.WriteString(JsonSerializer.Serialize(commentList));

            return response;
        }

        [Function("CommentsAwaitingModeration")]
        public HttpResponseData GetCommentsAwaitingModeration([HttpTrigger(AuthorizationLevel.Function, "get")] HttpRequestData req) {
            _logger.LogInformation("Retrieving comments awaiting moderation.");

            string? domain = req.Query["domain"];

            if (string.IsNullOrEmpty(domain)) {
                var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                errorResponse.WriteString("Invalid input: Domain is required");
                return errorResponse;
            }

            var commentsAwaitingModeration = _context.Comments
                .Include(c => c.User)
                .Where(c => c.Domain == domain && c.Status == CommentStatus.AwaitingModeration)
                .ToList();

            var response = req.CreateResponse(HttpStatusCode.OK);
            response.Headers.Add("Content-Type", "application/json; charset=utf-8");
            response.WriteString(JsonSerializer.Serialize(commentsAwaitingModeration));

            return response;
        }

    }
}
