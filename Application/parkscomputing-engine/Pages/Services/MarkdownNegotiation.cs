using System;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;

namespace ParksComputing.Engine.Pages.Services;

/// <summary>
/// A page's address answers in Markdown as well as HTML
/// (Architecture/padmajairam-port-design.md, "Readable by AI"). A request
/// whose Accept header prefers text/markdown to text/html gets the page's
/// Markdown (MarkdownPages) at the page's own address, as content
/// negotiation means (RFC 9110, section 12); any other request gets the
/// HTML page, carrying Link headers (RFC 8288) to its Markdown, the site's
/// llms.txt and its sitemap, so an agent finds them without reading the
/// page. Both say Vary: Accept, so a cache keeps them apart. A page's
/// address is the site's Site:PageUrl with the page's slug, and /home is
/// the home page.
/// </summary>
public sealed class MarkdownNegotiation {
    private readonly RequestDelegate _next;
    private readonly MarkdownPages _pages;
    private readonly Regex _pageUrl;

    public MarkdownNegotiation(RequestDelegate next, MarkdownPages pages, IOptions<SiteOptions> site) {
        _next = next; _pages = pages;
        // "/page/{slug}" or "/{slug}/" as a pattern, the closing slash optional.
        var template = site.Value.PageUrl.TrimEnd('/');
        _pageUrl = new Regex("^" + Regex.Escape(template).Replace(Regex.Escape("{slug}"), "(?<slug>[A-Za-z0-9_-]+)") + "/?$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    }

    private string? SlugOf(PathString path) {
        var p = path.Value ?? "/";
        if (p.Equals("/home", StringComparison.OrdinalIgnoreCase)) { return "index"; }
        var m = _pageUrl.Match(p);
        return m.Success ? m.Groups["slug"].Value : null;
    }

    /// <summary>Whether the request prefers Markdown to HTML: a higher
    /// quality for text/markdown than for text/html, a wildcard standing in
    /// for whichever it does not name.</summary>
    private static bool WantsMarkdown(HttpRequest request) {
        var accept = request.Headers.Accept.ToString();
        if (accept.IndexOf("markdown", StringComparison.OrdinalIgnoreCase) < 0) { return false; }
        if (!MediaTypeHeaderValue.TryParseList(request.Headers.Accept.ToArray(), out var types)) { return false; }
        double Quality(string type) {
            var exact = types.Where(t => t.MediaType.Equals(type, StringComparison.OrdinalIgnoreCase)).Select(t => t.Quality ?? 1.0).DefaultIfEmpty(-1).Max();
            if (exact >= 0) { return exact; }
            var group = types.Where(t => t.MediaType.Equals("text/*", StringComparison.OrdinalIgnoreCase) || t.MediaType.Equals("*/*", StringComparison.OrdinalIgnoreCase))
                .Select(t => t.Quality ?? 1.0).DefaultIfEmpty(0).Max();
            return group;
        }
        return Quality("text/markdown") > Quality("text/html");
    }

    public async Task InvokeAsync(HttpContext ctx) {
        var request = ctx.Request;
        var slug = (HttpMethods.IsGet(request.Method) || HttpMethods.IsHead(request.Method)) ? SlugOf(request.Path) : null;
        var page = slug is null ? null : _pages.Load(slug);
        if (page is null) { await _next(ctx); return; }

        var origin = _pages.OriginOr($"{request.Scheme}://{request.Host}");
        ctx.Response.Headers.Append(HeaderNames.Vary, "Accept");
        if (WantsMarkdown(request)) {
            ctx.Response.ContentType = "text/markdown; charset=utf-8";
            ctx.Response.Headers[HeaderNames.Link] = $"<{origin}{_pages.PageUrlOf(slug!)}>; rel=\"canonical\"";
            if (HttpMethods.IsHead(request.Method)) { return; }
            await ctx.Response.WriteAsync(_pages.Render(page, origin));
            return;
        }
        ctx.Response.OnStarting(() => {
            if (ctx.Response.StatusCode == StatusCodes.Status200OK
                && (ctx.Response.ContentType ?? "").StartsWith("text/html", StringComparison.OrdinalIgnoreCase)) {
                ctx.Response.Headers.Append(HeaderNames.Link, string.Join(", ",
                    $"<{_pages.MarkdownUrlOf(slug!)}>; rel=\"alternate\"; type=\"text/markdown\"",
                    "</llms.txt>; rel=\"alternate\"; type=\"text/plain\"; title=\"llms.txt\"",
                    "</sitemap.xml>; rel=\"sitemap\"; type=\"application/xml\""));
            }
            return Task.CompletedTask;
        });
        await _next(ctx);
    }
}
