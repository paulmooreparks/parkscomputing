using System.Net;
using System.Text.Json;

using Azure;

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
        public HttpResponseData Comment(
            [HttpTrigger(AuthorizationLevel.Function, "get", "delete", Route = "Comment/{commentId}")] HttpRequestData req, 
            string commentId,
            FunctionContext executionContext) 
        {
            _logger.LogInformation("Comment");

            if (string.IsNullOrEmpty(commentId)) {
                var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                errorResponse.WriteString("Invalid input: commentId is required");
                return errorResponse;
            }

            switch (req.Method.ToUpper()) {
                case "GET":
                    return GetComment(req, commentId);

                case "DELETE":
                    return DeleteComment(req, commentId);
            }

            return req.CreateResponse(HttpStatusCode.NotImplemented);
        }


        private HttpResponseData GetComment(HttpRequestData req, string commentId) {
            _logger.LogInformation("Get a comment");

            // Query the comment based on the provided parameters
            var comment = _context.Comments
                .Include(c => c.User) // Assuming a navigation property to the user
                .FirstOrDefault(c => c.CommentId == commentId);

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

        private HttpResponseData DeleteComment(HttpRequestData req, string commentId) {
            _logger.LogInformation("Delete a comment");

            var commentToDelete = _context.Comments
                .FirstOrDefault(c => c.CommentId == commentId);

            if (commentToDelete != null) {
                _context.Comments.Remove(commentToDelete);
                _context.SaveChanges();
            }
            else {
                return req.CreateResponse(HttpStatusCode.NotFound);
            }

            return req.CreateResponse(HttpStatusCode.NoContent); // Return NoContent (204) status to indicate success
        }

        [Function("Comment")]
        public HttpResponseData PutComment(
            [HttpTrigger(AuthorizationLevel.Function, "put")] HttpRequestData req,
            FunctionContext executionContext) 
        {
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

        [Function("Comment")]
        private HttpResponseData PostComment(
            [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequestData req,
            FunctionContext executionContext) {
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

        [Function("Comments")]
        public HttpResponseData Run(
            [HttpTrigger(AuthorizationLevel.Function, "get", Route = "Comments/{domain}/{pageId?}")] HttpRequestData req,
            string domain,
            string pageId,
            FunctionContext executionContext) {
            _logger.LogInformation("C# HTTP trigger function processed a request for a list of comments.");

            if (string.IsNullOrEmpty(domain)) {
                var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                errorResponse.WriteString("Invalid input: domain is required");
                return errorResponse;
            }

            IQueryable<Comment> query = _context.Comments
                .Include(c => c.User)
                .Where(c => c.Domain == domain);

            if (!string.IsNullOrEmpty(pageId)) {
                query = query.Where(c => c.PageId == pageId);
            }

            if (req.Query.AllKeys.Contains("status")) {
                string? status = req.Query["status"];

                if (!string.IsNullOrEmpty(status)) {
                    if (Enum.TryParse<CommentStatus>(status, true, out CommentStatus statusEnum)) {
                        query = query.Where(c => c.Status == statusEnum);
                    }
                    else if (int.TryParse(status, out int statusValue) && Enum.IsDefined(typeof(CommentStatus), statusValue)) {
                        query = query.Where(c => c.Status != null && (int)c.Status == statusValue);
                    }
                    else {
                        var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                        errorResponse.WriteString("Invalid input: Status is not valid");
                        return errorResponse;
                    }
                }
            }

            var commentList = query.ToList();

            var response = req.CreateResponse(HttpStatusCode.OK);
            response.Headers.Add("Content-Type", "application/json; charset=utf-8");
            response.WriteString(JsonSerializer.Serialize(commentList));

            return response;
        }
    }
}
