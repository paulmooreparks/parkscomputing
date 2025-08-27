namespace ParksComputing.Engine.Pages.Services {
    // Minimal internal stubs replacing SmartSam.Comments.Lib for now.
    public class Comment {
        public int Id { get; set; }
    // Some views expect CommentId; keep both for compatibility during transition.
    public int CommentId { get => Id; set => Id = value; }
        public string? Domain { get; set; }
        public string? PageId { get; set; }
        public string? Name { get; set; }
        public string? Email { get; set; }
        public string? Title { get; set; }
        public string? CommentText { get; set; }
        public System.DateTime CreateDateTime { get; set; } = System.DateTime.UtcNow;
    public CommentStatus Status { get; set; } = CommentStatus.Approved; // default approved for now
    }
    public class CommentResponse {
        public int Id { get; set; }
        public Comment Comment { get; set; } = new Comment();
    }
    public class LinkStub {
        public string? Rel { get; set; }
        public string? Method { get; set; }
        public string? Href { get; set; }
    }
    public enum CommentStatus { Pending, Approved, Rejected }
}
