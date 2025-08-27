using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.Api {
    // Canonical representation of a content item (post, page, draft) as a REST resource.
    public class ContentResource {
        public required string Id { get; set; } // slug or path key
        public required string Slug { get; set; }
        public string? Title { get; set; }
        public string? Description { get; set; }
        public DateTime? CreatedUtc { get; set; }
        public DateTime? UpdatedUtc { get; set; }
        public string? Language { get; set; }
        public string? RawMarkdown { get; set; }
        public string? RawHtml { get; set; }
    public bool Published { get; set; }
    [JsonIgnore]
    public string? ETag { get; set; } // Internal (header only)
    public List<LinkStub>? Links { get; set; }
    }
}
