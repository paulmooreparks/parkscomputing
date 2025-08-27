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

        /// <summary>Returns an example LoginRequest serialized as application/xfer so clients can mirror the syntax.</summary>
        [HttpGet("token/example")]
        [Produces("application/xfer")]
        public ActionResult GetExampleXfer() {
            var example = new LoginRequest { Username = "admin", Password = "ChangeMe!" };
            var serialized = _xfer.Serialize(example); // generic strongly-typed call
            return Content(serialized, XferService.ApplicationXfer);
        }

        /// <summary>
        /// Issue a JWT access token in exchange for credentials (placeholder static credential check).
        /// </summary>
        /// <remarks>
        /// Supports application/json or application/x-www-form-urlencoded.
        /// Example JSON: { "username":"admin", "password":"change-me" }
        /// Example form fields: username=admin&amp;password=change-me
        /// </remarks>
        /// <response code="200">Token issued</response>
        /// <response code="400">Validation / malformed body</response>
        /// <response code="401">Invalid credentials</response>
    [HttpPost("token")]
    [Consumes("application/json", "application/x-www-form-urlencoded", "application/xfer")]
        [Produces("application/json")]
        [ProducesResponseType(typeof(TokenResponse), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
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

            if (!await _creds.ValidateAsync(request!.Username!, request.Password!)) {
                _logger.LogInformation("Invalid credentials for user {User}", request.Username);
                return Unauthorized();
            }
            var token = _tokens.IssueToken(request.Username!);
            _logger.LogInformation("Token issued for user {User}", request.Username);
            return Ok(new TokenResponse(token, "Bearer", 8 * 3600));
        }

        private static string Truncate(string? value, int max) {
            if (string.IsNullOrEmpty(value)) { return string.Empty; }
            return value.Length <= max ? value : value.Substring(0, max) + "…";
        }
    }
}
