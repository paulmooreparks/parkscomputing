using System;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using System.Text.Json.Serialization;
using ParksComputing.Engine.Auth;
using ParksComputing.Engine.Xfer;
using ParksComputing.Xfer.Lang.Attributes;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Data.SqlClient; // for SqlException timeout detection

namespace ParksComputing.Engine.Api {
    [ApiController]
    [Route("api/auth")]
    public class AuthController : ControllerBase {
        private readonly TokenService _tokens;
        private readonly ILogger<AuthController> _logger;
        private readonly ICredentialService _creds;
        private readonly IXferService _xfer;
        public AuthController(TokenService tokens, ILogger<AuthController> logger, ICredentialService creds, IXferService xfer) { _tokens = tokens; _logger = logger; _creds = creds; _xfer = xfer; }

        public class LoginRequest {
            [Required]
            [JsonPropertyName("username")]
            [XferProperty("username")]
            public string? Username { get; set; }
            [Required]
            [JsonPropertyName("password")]
            [XferProperty("password")]
            public string? Password { get; set; }
        }
        public record TokenResponse(string AccessToken, string TokenType, int ExpiresInSeconds);

        /// <summary>
        /// Issue a JWT access token in exchange for credentials (placeholder static credential check).
        /// </summary>
        /// <remarks>
        /// Supports application/json, application/xfer, or application/x-www-form-urlencoded.
        /// Example JSON: { "username":"admin", "password":"change-me" }
        /// Example Xfer: {\n  username "admin"\n  password "change-me"\n}
        /// Example form fields: username=admin&amp;password=change-me
        /// Successful token (truncated): { "accessToken":"eyJhbGciOi...","tokenType":"Bearer","expiresInSeconds":28800 }
        /// </remarks>
        /// <response code="200">Token issued</response>
        /// <response code="400">Validation / malformed body</response>
        /// <response code="401">Invalid credentials</response>
        [HttpPost("token")]
        [AllowAnonymous]
        [Consumes("application/json", "application/x-www-form-urlencoded", "application/xfer")]
        [Produces("application/json")]
        [ProducesResponseType(typeof(TokenResponse), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
        public async System.Threading.Tasks.Task<ActionResult<TokenResponse>> Token([FromBody] LoginRequest? body) {
            _logger.LogInformation("Auth token request received (ContentType={ContentType})", Request.ContentType);

            LoginRequest? request = body;
            // NOTE: application/xfer bodies are handled exclusively by XferInputFormatter (no ad-hoc parsing here).
            // If JSON body not bound and it's a form POST, manually map form fields
            if (request == null && Request.HasFormContentType) {
                try {
                    var form = await Request.ReadFormAsync();
                    request = new LoginRequest { Username = form["username"], Password = form["password"] };
                }
                catch (Exception ex) {
                    _logger.LogWarning(ex, "Failed to read form data for auth token request");
                    ModelState.AddModelError("form", "Unable to read form data");
                }
            }

            if (request == null) {
                ModelState.AddModelError("request", "Missing credentials");
            }
            else {
                if (string.IsNullOrWhiteSpace(request.Username)) {
                    ModelState.AddModelError("username", "Username is required");
                }

                if (string.IsNullOrWhiteSpace(request.Password)) {
                    ModelState.AddModelError("password", "Password is required");
                }
            }

            if (!ModelState.IsValid) {
                var errors = string.Join("; ", ModelState.Keys.Select(k => k + ":" + string.Join(',', ModelState[k]!.Errors.Select(e => e.ErrorMessage))));
                _logger.LogWarning("Auth token invalid. Errors={Errors}", errors);
                return ValidationProblem(ModelState);
            }

            bool valid;
            try {
                valid = await _creds.ValidateAsync(request!.Username!, request.Password!);
            }
            catch (SqlException ex) when (ex.Number == -2) { // -2 = timeout (often cold start / serverless resume)
                _logger.LogWarning(ex, "Auth DB timeout during credential validation (likely cold database resume). Returning 503 to advise retry.");

                // Advise client to retry shortly
                Response.Headers["Retry-After"] = "5"; // seconds; tune as desired

                var problem = new ProblemDetails {
                    Status = StatusCodes.Status503ServiceUnavailable,
                    Title = "Service Unavailable",
                    Detail = "Authentication store is waking up; retry in a few seconds.",
                    Type = "https://httpstatuses.com/503",
                    Instance = HttpContext.Request.Path
                };

                // If client prefers xfer, mirror minimal structure (keep simple)
                var accept = Request.Headers["Accept"].ToString();
                if (!string.IsNullOrEmpty(accept) && accept.Contains("application/xfer", StringComparison.OrdinalIgnoreCase)) {
                    Response.ContentType = "application/xfer";
                    var xfer = "{\n  type \"https://httpstatuses.com/503\"\n  title \"Service Unavailable\"\n  status 503\n  detail \"Authentication store is waking up; retry in a few seconds.\"\n  instance \"" + HttpContext.Request.Path + "\"\n}";
                    return StatusCode(StatusCodes.Status503ServiceUnavailable, xfer);
                }

                return StatusCode(StatusCodes.Status503ServiceUnavailable, problem);
            }
            catch (SqlException ex) {
                _logger.LogError(ex, "Unexpected SQL error during credential validation");
                // Hide internal details but signal temporary issue
                Response.Headers["Retry-After"] = "10";
                var problem = new ProblemDetails {
                    Status = StatusCodes.Status503ServiceUnavailable,
                    Title = "Service Unavailable",
                    Detail = "Authentication service temporarily unavailable.",
                    Type = "https://httpstatuses.com/503",
                    Instance = HttpContext.Request.Path
                };
                return StatusCode(StatusCodes.Status503ServiceUnavailable, problem);
            }

            if (!valid) {
                _logger.LogInformation("Invalid credentials for user {User}", request.Username);
                return Unauthorized();
            }

            var token = _tokens.IssueToken(request.Username!);
            _logger.LogInformation("Token issued for user {User}", request.Username);
            return Ok(new TokenResponse(token, "Bearer", 8 * 3600));
        }

        private static string Truncate(string? value, int max) {
            if (string.IsNullOrEmpty(value)) {
                return string.Empty;
            }

            return value.Length <= max ? value : value.Substring(0, max) + "…";
        }
    }
}
