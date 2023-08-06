namespace SmartSam.Comments.Api.Models {
    public class Link {
        public required string Rel { get; set; }
        public required string Method { get; set; }
        public required string? Href { get; set; }
    }
}
