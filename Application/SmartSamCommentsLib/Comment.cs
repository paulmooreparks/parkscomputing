namespace SmartSam.Comments.Lib {
    public class Comment {
        public string? Id { get; set; }
        public string? Domain { get; set; }
        public string? PageId { get; set; }
        public string? Title { get; set; }
        public string? Name { get; set; }
        public string? Email { get; set; }
        public string? CommentText { get; set; }
        public DateTime CreateDateTime { get; set; }
    }
}