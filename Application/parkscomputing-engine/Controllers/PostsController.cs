using Microsoft.AspNetCore.Mvc;
using ParksComputing.Engine.Api;
using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace ParksComputing.Engine.Controllers {
    [Route("posts")]
    public class PostsController : Controller {
        private readonly IContentStorage _storage;

        public PostsController(IContentStorage storage) {
            _storage = storage;
        }

        // GET /posts
        // GET /posts?tag=programming
        // GET /posts?tags=programming,algorithms (comma-separated, OR logic)
        // GET /posts?tags=programming+algorithms (plus-separated, AND logic)
        // GET /posts?tags=programming|travel (pipe-separated, OR logic)
        [HttpGet]
        public async Task<IActionResult> Index([FromQuery] string? tag, [FromQuery] string? tags, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken ct = default) {
            if (page < 1) page = 1;
            if (pageSize < 1) pageSize = 1;
            if (pageSize > 100) pageSize = 100;

            var allContent = await _storage.ListAsync(null, ct);
            var publishedContent = allContent.Where(c => c.Published).ToList();

            // Apply tag filtering
            if (!string.IsNullOrWhiteSpace(tag)) {
                // Single tag filtering
                publishedContent = publishedContent
                    .Where(c => c.Tags.Contains(tag, StringComparer.OrdinalIgnoreCase))
                    .ToList();
            }
            else if (!string.IsNullOrWhiteSpace(tags)) {
                // Multiple tag filtering with different separators
                if (tags.Contains('+')) {
                    // Plus-separated: AND logic (all tags must be present)
                    var tagList = tags.Split('+', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                    publishedContent = publishedContent
                        .Where(c => tagList.All(t => c.Tags.Contains(t, StringComparer.OrdinalIgnoreCase)))
                        .ToList();
                }
                else if (tags.Contains('|')) {
                    // Pipe-separated: OR logic (any tag must be present)
                    var tagList = tags.Split('|', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                    publishedContent = publishedContent
                        .Where(c => tagList.Any(t => c.Tags.Contains(t, StringComparer.OrdinalIgnoreCase)))
                        .ToList();
                }
                else {
                    // Comma-separated: OR logic (any tag must be present) - default behavior
                    var tagList = tags.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                    publishedContent = publishedContent
                        .Where(c => tagList.Any(t => c.Tags.Contains(t, StringComparer.OrdinalIgnoreCase)))
                        .ToList();
                }
            }

            var total = publishedContent.Count;
            var pagedContent = publishedContent.Skip((page - 1) * pageSize).Take(pageSize).ToList();

            ViewData["Tag"] = tag;
            ViewData["Tags"] = tags;
            ViewData["Page"] = page;
            ViewData["PageSize"] = pageSize;
            ViewData["Total"] = total;
            ViewData["TotalPages"] = (int) Math.Ceiling((double) total / pageSize);

            return View(pagedContent);
        }
    }
}
