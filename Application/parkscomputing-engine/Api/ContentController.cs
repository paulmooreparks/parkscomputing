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
using ParksComputing.Engine.Pages.Services; // LinkStub

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

        public record CreateContentRequest(string? Slug, string? Title, string? Description, string? Language, string? BodyMarkdown, List<string>? Tags);

        /// <summary>List content items (paged).</summary>
        /// <param name="prefix">Optional path/slug prefix filter.</param>
        /// <param name="tag">Single tag to filter by.</param>
        /// <param name="tags">Multiple tags to filter by (comma-separated).</param>
        /// <param name="page">1-based page index (>=1).</param>
        /// <param name="pageSize">Items per page (1-100).</param>
        /// <param name="includeDrafts">Include draft items (default false).</param>
        /// <param name="ct">Cancellation token.</param>
        // GET api/content?prefix=blog/2025&tag=programming&page=1&pageSize=20
        [HttpGet]
        [AllowAnonymous]
        [ProducesResponseType(StatusCodes.Status200OK)]
        public async Task<ActionResult<IEnumerable<ContentResource>>> List([FromQuery] string? prefix, [FromQuery] string? tag, [FromQuery] string? tags, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, [FromQuery] bool includeDrafts = false, CancellationToken ct = default) {
            if (page < 1) {
                page = 1;
            }

            if (pageSize < 1) {
                pageSize = 1;
            }

            if (pageSize > 100) {
                pageSize = 100;
            }

            var full = await _storage.ListAsync(prefix, ct);
            if (!includeDrafts) {
                full = full.Where(c => c.Published).ToList();
            }

            // Apply tag filtering
            if (!string.IsNullOrWhiteSpace(tag)) {
                full = full.Where(c => c.Tags.Contains(tag, StringComparer.OrdinalIgnoreCase)).ToList();
            }
            else if (!string.IsNullOrWhiteSpace(tags)) {
                var tagList = tags.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                if (tagList.Length > 0) {
                    full = full.Where(c => tagList.Any(t => c.Tags.Contains(t, StringComparer.OrdinalIgnoreCase))).ToList();
                }
            }

            var total = full.Count();
            var list = full.Skip((page - 1) * pageSize).Take(pageSize).ToList();

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

            Response.Headers["X-Total-Count"] = total.ToString();
            Response.Headers["X-Page"] = page.ToString();
            Response.Headers["X-Page-Size"] = pageSize.ToString();
            return Ok(list);
        }

        // HEAD api/content
        [HttpHead]
        [AllowAnonymous]
        [ApiExplorerSettings(IgnoreApi = true)]
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
        [ApiExplorerSettings(IgnoreApi = true)]
        public IActionResult OptionsCollection() {
            Response.Headers["Allow"] = "GET,HEAD,OPTIONS,POST";
            return Ok();
        }

        // GET api/content/{id}
        [HttpGet("{id}")]
        [AllowAnonymous]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status304NotModified)]
        public async Task<ActionResult<ContentResource>> Get(string id, CancellationToken ct) {
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
        [ApiExplorerSettings(IgnoreApi = true)]
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
        [Consumes("application/json", "application/xfer")]
        [Authorize]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status412PreconditionFailed)]
        [ProducesResponseType(StatusCodes.Status428PreconditionRequired)]
        public async Task<ActionResult<ContentResource>> Put(string id, [FromBody] UpdateContentRequest request, CancellationToken ct) {
            if (request == null) {
                return BadRequest();
            }

            string? ifMatch = Request.Headers.TryGetValue("If-Match", out var v) ? Unquote(v.FirstOrDefault()) : null;
            var existing = await _storage.GetAsync(id, ct);
            var now = DateTime.UtcNow;
            ContentResource resource;

            if (existing == null) {
                // Create via PUT (idempotent creation)
                resource = new ContentResource {
                    Id = id,
                    Slug = id,
                    Title = request.Title,
                    Description = request.Description,
                    Language = request.Language,
                    CreatedUtc = now,
                    UpdatedUtc = now,
                    RawMarkdown = request.BodyMarkdown,
                    Tags = request.Tags ?? new List<string>()
                };
            }
            else {
                // Concurrency requires If-Match when updating
                if (ifMatch == null) {
                    // Signal client to supply ETag (precondition required)
                    return StatusCode(StatusCodes.Status428PreconditionRequired);
                }

                resource = existing;
                resource.Title = request.Title;
                resource.Description = request.Description;
                resource.Language = request.Language;
                resource.RawMarkdown = request.BodyMarkdown;
                resource.Tags = request.Tags ?? resource.Tags;
                resource.UpdatedUtc = now;
            }

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
        [Consumes("application/json", "application/xfer")]
        [Authorize]
        [ProducesResponseType(StatusCodes.Status201Created)]
        [ProducesResponseType(StatusCodes.Status409Conflict)]
        public async Task<ActionResult<ContentResource>> Post([FromBody] CreateContentRequest request, CancellationToken ct) {
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
                RawMarkdown = request.BodyMarkdown,
                Tags = request.Tags ?? new List<string>()
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
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status412PreconditionFailed)]
        public async Task<IActionResult> Delete(string id, CancellationToken ct) {
            string? ifMatch = Request.Headers.TryGetValue("If-Match", out var v) ? Unquote(v.FirstOrDefault()) : null;
            try {
                bool deleted = await _storage.DeleteAsync(id, ifMatch, ct);
                if (!deleted) {
                    return NotFound();
                }
                return NoContent();
            }
            catch (ETagMismatchException ex) {
                Response.Headers["ETag"] = Quote(ex.CurrentETag);
                return StatusCode(StatusCodes.Status412PreconditionFailed);
            }
        }

        // OPTIONS api/content/{id}
        [HttpOptions("{id}")]
        [AllowAnonymous]
        [ApiExplorerSettings(IgnoreApi = true)]
        public IActionResult OptionsForResource() {
            Response.Headers["Allow"] = "GET,HEAD,OPTIONS,PUT,DELETE";
            return Ok();
        }

        private void ApplyHypermedia(ContentResource r) {
            r.Links ??= new List<LinkStub>();
            string self = Url.ActionLink(nameof(Get), values: new { id = r.Id })!;

            if (!r.Links.Any(l => l.Rel == "self")) {
                r.Links.Add(new LinkStub { Rel = "self", Method = "GET", Href = self });
            }
            if (!r.Links.Any(l => l.Rel == "upsert")) {
                r.Links.Add(new LinkStub { Rel = "upsert", Method = "PUT", Href = self });
            }
            if (!r.Links.Any(l => l.Rel == "delete")) {
                r.Links.Add(new LinkStub { Rel = "delete", Method = "DELETE", Href = self });
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
