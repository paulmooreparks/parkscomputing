using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Azure.Functions.Worker;

using Microsoft.Extensions.Logging;

using SmartSam.Comments.Lib;

namespace SmartSam.Comments.Service {
    public class Users {
        private readonly ILogger _logger;

        public Users(ILoggerFactory loggerFactory) {
            _logger = loggerFactory.CreateLogger<Users>();
        }

        private static Dictionary<string, Dictionary<string, User>> DomainUsers { get; set; } = new Dictionary<string, Dictionary<string, User>>();
        // private static Dictionary<string, Dictionary<string, Comment>> PageComments = new Dictionary<string, Dictionary<string, Comment>>();

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

            string key = $"{domain}_{userId}";
            List<User> userList;

            lock (DomainUsers) {
                if (DomainUsers.ContainsKey(key)) {
                    userList = DomainUsers[key].Values.ToList<User>();
                }
                else {
                    userList = new List<User>(); // Return an empty list if no comments are found
                }
            }

            var response = req.CreateResponse(HttpStatusCode.OK);
            response.Headers.Add("Content-Type", "application/json; charset=utf-8");
            response.WriteString(JsonSerializer.Serialize(userList));

            return response;
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
                errorResponse.WriteString("Invalid input: Domain and PageId are required");
                return errorResponse;
            }

            string key = $"{domain}_{userId}";

            lock (DomainUsers) {
                if (DomainUsers.ContainsKey(key) && DomainUsers[key].ContainsKey(userId)) {
                    User comment = DomainUsers[key][userId];
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

        private HttpResponseData PostUser(HttpRequestData req) {
            _logger.LogInformation("Post a comment");
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

            var domain = newUser.Domain;
            var userId = newUser.UserId;
            string key = $"{domain}_{userId}";

            // Generate a unique ID for the comment
            newUser.UserId = Guid.NewGuid().ToString();

            // Lock the dictionaries while updating to ensure thread-safety
            lock (DomainUsers) {
                if (!DomainUsers.ContainsKey(key)) {
                    DomainUsers[key] = new Dictionary<string, User>();
                }

                DomainUsers[key][newUser.UserId] = newUser;
            }

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

            string key = $"{updatedUser.Domain}_{updatedUser.UserId}";
            string userId = updatedUser.UserId; 

            lock (DomainUsers) {
                if (DomainUsers.ContainsKey(key) && DomainUsers[key].ContainsKey(userId)) {
                    DomainUsers[key][userId] = updatedUser; 
                    var response = req.CreateResponse(HttpStatusCode.OK);
                    response.Headers.Add("Content-Type", "application/json; charset=utf-8");
                    response.WriteString(JsonSerializer.Serialize(updatedUser));
                    return response;
                }
                else {
                    return req.CreateResponse(HttpStatusCode.NotFound);
                }
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

            string key = $"{domain}_{userId}";

            lock (DomainUsers) {
                if (DomainUsers.ContainsKey(key) && DomainUsers[key].ContainsKey(userId)) {
                    DomainUsers[key].Remove(userId);

                    // Optionally, you can remove the key if there are no more comments
                    if (DomainUsers[key].Count == 0) {
                        DomainUsers.Remove(key);
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
