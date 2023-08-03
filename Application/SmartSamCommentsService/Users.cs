using System.Net;
using System.Text.Json;

using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

using SmartSam.Comments.Lib;
using SmartSam.Comments.Data;

namespace SmartSam.Comments.Service {
    public class Users {
        private readonly ILogger _logger;
        private readonly AppDbContext _context;

        public Users(ILoggerFactory loggerFactory, AppDbContext context) {
            _logger = loggerFactory.CreateLogger<Users>();
            _context = context;
        }

        [Function("User")]
        public HttpResponseData User([HttpTrigger(AuthorizationLevel.Function, "get", "put", "post", "delete")] HttpRequestData req, FunctionContext executionContext) {
            _logger.LogInformation("User");

            switch (req.Method.ToUpper()) {
                case "GET":
                    return GetUser(req);

                case "POST":
                    return PostUser(req);

                case "PUT":
                    return PutUser(req);

                case "DELETE":
                    return DeleteUser(req);
            }

            return req.CreateResponse(HttpStatusCode.NotImplemented);
        }


        private HttpResponseData GetUser(HttpRequestData req) {
            _logger.LogInformation("Get a user");
            string? domain = req.Query["domain"];
            string? userId = req.Query["userId"];

            if (string.IsNullOrEmpty(domain) || string.IsNullOrEmpty(userId)) {
                var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                errorResponse.WriteString("Invalid input: domain and userId are required");
                return errorResponse;
            }

            var user = _context.Users
                .FirstOrDefault(c => c.Domain == domain && c.UserId == userId);

            if (user != null) {
                var response = req.CreateResponse(HttpStatusCode.OK);
                response.Headers.Add("Content-Type", "application/json; charset=utf-8");
                response.WriteString(JsonSerializer.Serialize(user));
                return response;
            }
            else {
                return req.CreateResponse(HttpStatusCode.NotFound); // Return 404 if no comment is found
            }
        }

        private HttpResponseData PostUser(HttpRequestData req) {
            _logger.LogInformation("Post a user");
            string? requestBody = req.ReadAsStringAsync().Result;

            if (requestBody is null) {
                var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                errorResponse.WriteString("Invalid input");
                return errorResponse;
            }

            User? newUser = JsonSerializer.Deserialize<User>(requestBody);

            if (newUser is null) {
                var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                errorResponse.WriteString("Invalid comment data");
                return errorResponse;
            }

            // Generate a unique ID for the comment
            newUser.UserId = Guid.NewGuid().ToString();

            _context.Users.Add(newUser);
            _context.SaveChanges();

            // Create a response
            var response = req.CreateResponse(HttpStatusCode.Created);
            response.Headers.Add("Content-Type", "application/json; charset=utf-8");
            response.WriteString(JsonSerializer.Serialize(newUser));

            return response;
        }

        public HttpResponseData PutUser(HttpRequestData req) {
            _logger.LogInformation("Put a user");
            string? requestBody = req.ReadAsStringAsync().Result;

            if (requestBody is null) {
                var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                errorResponse.WriteString("Invalid input");
                return errorResponse;
            }

            User? updatedUser = JsonSerializer.Deserialize<User>(requestBody);

            if (updatedUser is null) {
                var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                errorResponse.WriteString("Invalid user data");
                return errorResponse;
            }

            if (string.IsNullOrEmpty(updatedUser.UserId)) {
                var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                errorResponse.WriteString("Invalid user data");
                return errorResponse;
            }

            var existingUser = _context.Comments.Find(updatedUser.UserId);

            if (existingUser != null) {
                // Update the existing comment with the new data
                _context.Entry(existingUser).CurrentValues.SetValues(updatedUser);
                _context.SaveChanges();

                var response = req.CreateResponse(HttpStatusCode.OK);
                response.Headers.Add("Content-Type", "application/json; charset=utf-8");
                response.WriteString(JsonSerializer.Serialize(updatedUser));
                return response;
            }
            else {
                return req.CreateResponse(HttpStatusCode.NotFound);
            }
        }

        private HttpResponseData DeleteUser(HttpRequestData req) {
            _logger.LogInformation("Delete a user");
            string? domain = req.Query["domain"];
            string? userId = req.Query["userId"];

            if (string.IsNullOrEmpty(domain) || string.IsNullOrEmpty(userId)) {
                var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                errorResponse.WriteString("Invalid input: Domain, PageId, and CommentId are required");
                return errorResponse;
            }

            var userToDelete = _context.Users
                .FirstOrDefault(c => c.Domain == domain && c.UserId == userId);

            if (userToDelete != null) {
                _context.Users.Remove(userToDelete);
                _context.SaveChanges();
            }
            else {
                return req.CreateResponse(HttpStatusCode.NotFound);
            }

            return req.CreateResponse(HttpStatusCode.NoContent); // Return NoContent (204) status to indicate success
        }

        [Function("Users")]
        public HttpResponseData Run([HttpTrigger(AuthorizationLevel.Function, "get")] HttpRequestData req) {
            _logger.LogInformation("C# HTTP trigger function processed a request for a list of comments.");
            string? domain = req.Query["domain"];
            string? userId = req.Query["userId"];

            if (string.IsNullOrEmpty(domain) || string.IsNullOrEmpty(userId)) {
                var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                errorResponse.WriteString("Invalid input: Domain and PageId are required");
                return errorResponse;
            }

            var userList = _context.Users.Where(c => c.Domain == domain && c.UserId == userId).ToList();

            var response = req.CreateResponse(HttpStatusCode.OK);
            response.Headers.Add("Content-Type", "application/json; charset=utf-8");
            response.WriteString(JsonSerializer.Serialize(userList));

            return response;
        }
    }
}
