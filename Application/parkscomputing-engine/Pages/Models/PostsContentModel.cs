using System.Collections.Generic;
using System.Linq;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.Pages.Models
{
    /// <summary>
    /// A &lt;posts-content&gt; list on a content page: the cards, links or
    /// excerpts of a set of sitenav entries. The entries come in the order
    /// sitenav.xfer gives them (Paul, 2026-10-01); a page may still ask for
    /// another order with sort="recent", "popular" or "alphabetical".
    /// </summary>
    public class PostsContentModel
    {
        public IReadOnlyList<NavNode> Entries { get; set; } = new List<NavNode>();
        public string Format { get; set; } = "cards"; // cards, links, excerpts
        public int Limit { get; set; } = int.MaxValue;
        public string Style { get; set; } = "";
        public string Category { get; set; } = "";
        public string Sort { get; set; } = "order"; // order, recent, popular, alphabetical
        public bool ShowDates { get; set; } = true;
        public bool ShowExcerpts { get; set; } = true;

        public static PostsContentModel FromAttributes(Dictionary<string, string> attributes, IReadOnlyList<NavNode> entries)
        {
            var model = new PostsContentModel { Entries = entries };

            if (attributes.TryGetValue("format", out var format))
                model.Format = format.ToLowerInvariant();

            if (attributes.TryGetValue("limit", out var limitStr) && int.TryParse(limitStr, out var limit))
                model.Limit = limit;

            if (attributes.TryGetValue("style", out var style))
                model.Style = style;

            if (attributes.TryGetValue("category", out var category))
                model.Category = category;

            if (attributes.TryGetValue("sort", out var sort))
                model.Sort = sort.ToLowerInvariant();

            if (attributes.TryGetValue("show-dates", out var showDatesStr) && bool.TryParse(showDatesStr, out var showDates))
                model.ShowDates = showDates;

            if (attributes.TryGetValue("show-excerpts", out var showExcerptsStr) && bool.TryParse(showExcerptsStr, out var showExcerpts))
                model.ShowExcerpts = showExcerpts;

            return model;
        }

        public IEnumerable<NavNode> GetFilteredPosts()
        {
            var posts = Entries.AsEnumerable();

            if (!string.IsNullOrEmpty(Category))
            {
                posts = posts.Where(p => p.Description?.Contains(Category, System.StringComparison.OrdinalIgnoreCase) == true);
            }

            posts = Sort switch
            {
                "recent" => posts.OrderByDescending(p => NavService.EffectiveDate(p) ?? System.DateTime.MinValue),
                "popular" => posts.OrderByDescending(p => p.Order ?? 0),
                "alphabetical" => posts.OrderBy(p => p.Title),
                _ => posts
            };

            if (Limit < int.MaxValue)
            {
                posts = posts.Take(Limit);
            }

            return posts;
        }
    }
}
