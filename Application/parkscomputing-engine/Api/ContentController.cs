using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using System.Text;

namespace ParksComputing.Engine.Api {
    [ApiController]
    [Route("api/content")]
    [Produces("application/json")] // Can extend with content-negotiated representations later
    public class ContentController : ControllerBase {
        private readonly IContentStorage _storage;
        private readonly ILogger<ContentController> _logger;
        public ContentController(IContentStorage storage, ILogger<ContentController> logger) {
            _storage = storage; _logger = logger;
        }

        public record CreateContentRequest(string? Slug, string? Title, string? Description, string? Language, string? BodyMarkdown);

        // GET api/content?prefix=blog/2025
        [HttpGet]
        [AllowAnonymous]
        public async Task<ActionResult<IEnumerable<ContentResource>>> List([FromQuery]string? prefix, CancellationToken ct) {
            var list = await _storage.ListAsync(prefix, ct);

            foreach (var item in list) {
                ApplyHypermedia(item);
            }

            // Aggregate weak ETag for collection (order-independent by hashing sorted etags)
            var etags = list.Where(i => !string.IsNullOrEmpty(i.ETag)).Select(i => i.ETag!).OrderBy(e => e).ToArray();

            if (etags.Length > 0) {
                var agg = ComputeAggregateETag(etags);
                Response.Headers["ETag"] = Quote("W/" + agg);

                if (Request.Headers.TryGetValue("If-None-Match", out var inm) && inm.Contains(Quote("W/" + agg))) {
                    return StatusCode(StatusCodes.Status304NotModified);
                }
            }

            return Ok(list);
        }

        // HEAD api/content
        [HttpHead]
        [AllowAnonymous]
        public async Task<IActionResult> HeadCollection([FromQuery] string? prefix, CancellationToken ct) {
            var list = await _storage.ListAsync(prefix, ct);
            var etags = list.Where(i => !string.IsNullOrEmpty(i.ETag)).Select(i => i.ETag!).OrderBy(e => e).ToArray();

            if (etags.Length > 0) {
                Response.Headers["ETag"] = Quote("W/" + ComputeAggregateETag(etags));
            }

            return Ok();
        }

        // OPTIONS api/content
        [HttpOptions]
        [AllowAnonymous]
        public IActionResult OptionsCollection() {
            Response.Headers["Allow"] = "GET,HEAD,OPTIONS,POST";
            return Ok();
        }

        // GET api/content/{id}
        [HttpGet("{id}")]
        [AllowAnonymous]
        public async Task<ActionResult> Get(string id, CancellationToken ct) {
            var res = await _storage.GetAsync(id, ct);

            if (res == null) {
                return NotFound();
            }

            var currentEtag = Quote(res.ETag);

            if (Request.Headers.TryGetValue("If-None-Match", out var inm)) {
                var token = inm.FirstOrDefault();

                if (!string.IsNullOrEmpty(token) && string.Equals(token, currentEtag, StringComparison.Ordinal)) {
                    Response.Headers["ETag"] = currentEtag;
                    return StatusCode(StatusCodes.Status304NotModified);
                }
            }

            ApplyHypermedia(res);
            Response.Headers["ETag"] = currentEtag;

            // Content negotiation: if client explicitly wants markdown
            var accept = Request.Headers["Accept"].ToString();

            if (!string.IsNullOrWhiteSpace(accept) && accept.Contains("text/markdown", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrEmpty(res.RawMarkdown)) {
                return Content(res.RawMarkdown, "text/markdown", Encoding.UTF8);
            }

            return Ok(res);
        }

        // HEAD api/content/{id} => metadata only (ETag) per REST uniform interface
        [HttpHead("{id}")]
        [AllowAnonymous]
        public async Task<IActionResult> Head(string id, CancellationToken ct) {
            var res = await _storage.GetAsync(id, ct);

            if (res == null) {
                return NotFound();
            }

            Response.Headers["ETag"] = Quote(res.ETag);
            return Ok();
        }

        // PUT api/content/{id}
        [HttpPut("{id}")]
        [Authorize]
        public async Task<ActionResult<ContentResource>> Put(string id, [FromBody]ContentResource resource, CancellationToken ct) {
            if (resource == null) {
                return BadRequest();
            }

            resource.Id = id;
            string? ifMatch = Request.Headers.TryGetValue("If-Match", out var v) ? Unquote(v.FirstOrDefault()) : null;

            try {
                var saved = await _storage.UpsertAsync(resource, ifMatch, ct);
                ApplyHypermedia(saved);
                Response.Headers["ETag"] = Quote(saved.ETag);
                return Ok(saved);
            }
            catch (ETagMismatchException ex) {
                Response.Headers["ETag"] = Quote(ex.CurrentETag);
                return StatusCode(StatusCodes.Status412PreconditionFailed);
            }
        }

        // POST api/content (create with server or client provided slug)
        [HttpPost]
        [Authorize]
        public async Task<ActionResult<ContentResource>> Post([FromBody]CreateContentRequest request, CancellationToken ct) {
            if (request == null) {
                return BadRequest();
            }

            var slug = string.IsNullOrWhiteSpace(request.Slug) ? Slugify(request.Title ?? Guid.NewGuid().ToString("n")) : Slugify(request.Slug!);
            var existing = await _storage.GetAsync(slug, ct);

            if (existing != null) { return Conflict(new { message = "Resource with slug already exists", slug }); }
            var resource = new ContentResource {
                Id = slug,
                Slug = slug,
                Title = request.Title,
                Description = request.Description,
                Language = request.Language,
                CreatedUtc = DateTime.UtcNow,
                UpdatedUtc = DateTime.UtcNow,
                RawMarkdown = request.BodyMarkdown
            };

            var saved = await _storage.UpsertAsync(resource, null, ct);
            ApplyHypermedia(saved);
            var location = Url.ActionLink(nameof(Get), values: new { id = saved.Id });
            Response.Headers["Location"] = location;
            Response.Headers["ETag"] = Quote(saved.ETag);
            return Created(location!, saved);
        }

        // DELETE api/content/{id}
        [HttpDelete("{id}")]
        [Authorize]
        public async Task<IActionResult> Delete(string id, CancellationToken ct) {
            string? ifMatch = Request.Headers.TryGetValue("If-Match", out var v) ? Unquote(v.FirstOrDefault()) : null;
            try {
                bool deleted = await _storage.DeleteAsync(id, ifMatch, ct);
                if (!deleted) {
                    return NotFound();
                }

                return NoContent();
            } catch (ETagMismatchException ex) {
                Response.Headers["ETag"] = Quote(ex.CurrentETag);
                return StatusCode(StatusCodes.Status412PreconditionFailed);
            }
        }

        // OPTIONS api/content/{id}
        [HttpOptions("{id}")]
        [AllowAnonymous]
        public IActionResult OptionsForResource() {
            Response.Headers["Allow"] = "GET,HEAD,OPTIONS,PUT,DELETE";
            return Ok();
        }

        private void ApplyHypermedia(ContentResource r) {
            r.Links ??= new List<SmartSam.Comments.Lib.Link>();
            string self = Url.ActionLink(nameof(Get), values: new { id = r.Id })!;

            if (!r.Links.Any(l => l.Rel == "self")) {
                r.Links.Add(new SmartSam.Comments.Lib.Link { Rel = "self", Method = "GET", Href = self });
            }

            if (!r.Links.Any(l => l.Rel == "upsert")) {
                r.Links.Add(new SmartSam.Comments.Lib.Link { Rel = "upsert", Method = "PUT", Href = self });
            }

            if (!r.Links.Any(l => l.Rel == "delete")) {
                r.Links.Add(new SmartSam.Comments.Lib.Link { Rel = "delete", Method = "DELETE", Href = self });
            }
        }

        private static string Quote(string? etag) => etag == null ? string.Empty : '"' + etag + '"';
        private static string? Unquote(string? v) {
            if (string.IsNullOrEmpty(v)) {
                return v;
            }

            if (v.StartsWith('"') && v.EndsWith('"')) {
                return v.Substring(1, v.Length - 2);
            }

            return v;
        }

        private static string Slugify(string value) {
            if (string.IsNullOrWhiteSpace(value)) {
                return "item";
            }

            var sb = new StringBuilder();
            bool lastDash = false;

            foreach (var c in value.ToLowerInvariant()) {
                if (char.IsLetterOrDigit(c)) {
                    sb.Append(c); lastDash = false;
                }
                else if (c == ' ' || c == '-' || c == '_') {
                    if (!lastDash) {
                        sb.Append('-'); lastDash = true;
                    }
                }
            }

            var result = sb.ToString().Trim('-');
            return string.IsNullOrEmpty(result) ? "item" : result;
        }

        private static string ComputeAggregateETag(string[] etags) {
            // Simple SHA256 of concatenated etags
            using var sha = System.Security.Cryptography.SHA256.Create();
            var bytes = Encoding.UTF8.GetBytes(string.Join('\n', etags));
            return System.Convert.ToHexString(sha.ComputeHash(bytes));
        }
    }
}
