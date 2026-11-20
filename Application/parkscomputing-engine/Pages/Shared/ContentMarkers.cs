using System.IO;
using System.Linq;
using System.Text.Encodings.Web;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc.Rendering;
using Microsoft.AspNetCore.Mvc.ViewFeatures;
using ParksComputing.Engine.Pages.Models;

namespace ParksComputing.Engine.Pages.Shared;

/// <summary>
/// Draws the lists a content page asks for. While a page loads, each
/// &lt;posts-content&gt; and &lt;nav-content&gt; element in it is replaced
/// by a marker, with the list's model kept in ViewData under the marker
/// (PageLoaderModel.ProcessContentPlaceholders and IndexModel's). The
/// page's view then calls this to put each list's HTML where its marker
/// is. The home page and every other content page share it, so a list
/// works the same on any of them.
/// </summary>
public static class ContentMarkers {
    public static async Task<string> RenderAsync(IHtmlHelper html, ViewDataDictionary viewData, string content) {
        foreach (var key in viewData.Keys.Where(k => k.StartsWith("RENDER_POSTS_")).ToList()) {
            if (viewData[key] is PostsContentModel posts && content.Contains(key)) {
                content = content.Replace(key, await Draw(html, PostsContentModel.PartialFor(posts.Format), posts));
            }
        }
        foreach (var key in viewData.Keys.Where(k => k.StartsWith("RENDER_NAV_")).ToList()) {
            if (viewData[key] is NavContentModel nav && content.Contains(key)) {
                var partial = nav.Format switch {
                    "vertical" => "_NavVertical",
                    "breadcrumb" => "_NavBreadcrumb",
                    "sidebar" => "_NavSidebar",
                    _ => "_NavHorizontal"
                };
                content = content.Replace(key, await Draw(html, partial, nav));
            }
        }
        return content;
    }

    private static async Task<string> Draw(IHtmlHelper html, string partial, object model) {
        var drawn = await html.PartialAsync(partial, model);
        using var writer = new StringWriter();
        drawn.WriteTo(writer, HtmlEncoder.Default);
        return writer.ToString();
    }
}
