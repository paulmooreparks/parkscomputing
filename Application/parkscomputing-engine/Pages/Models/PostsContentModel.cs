using System.Collections.Generic;
using System.Linq;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.Pages.Models
{
    public class PostsContentModel
    {
        public NavNode? NavNode { get; set; }
        public string Format { get; set; } = "cards"; // cards, links, excerpts
        public int Limit { get; set; } = int.MaxValue;
        public string Style { get; set; } = "";
        public string Category { get; set; } = "";
        public string Sort { get; set; } = "recent"; // recent, popular, alphabetical
        public bool ShowDates { get; set; } = true;
        public bool ShowExcerpts { get; set; } = true;

        public static PostsContentModel FromAttributes(Dictionary<string, string> attributes, NavNode? navNode)
        {
            var model = new PostsContentModel { NavNode = navNode };

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
            if (NavNode?.Posts == null) return new List<NavNode>();

            var posts = NavNode.Posts.AsEnumerable();

            // Apply category filter
            if (!string.IsNullOrEmpty(Category))
            {
                posts = posts.Where(p => p.Description?.Contains(Category, System.StringComparison.OrdinalIgnoreCase) == true);
            }

            // Apply sorting
            posts = Sort switch
            {
                "recent" => posts.OrderByDescending(p => p.Date ?? System.DateTime.MinValue),
                "popular" => posts.OrderByDescending(p => p.Order ?? 0), // Use Order as popularity metric
                "alphabetical" => posts.OrderBy(p => p.Title),
                _ => posts.OrderByDescending(p => p.Date ?? System.DateTime.MinValue)
            };

            // Apply limit
            if (Limit < int.MaxValue)
            {
                posts = posts.Take(Limit);
            }

            return posts;
        }
    }
}
