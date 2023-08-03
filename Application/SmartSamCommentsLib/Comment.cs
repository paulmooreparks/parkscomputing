namespace SmartSam.Comments.Lib {
    public class Comment {
        public string? CommentId { get; set; }
        public string? Domain { get; set; }
        public string? PageId { get; set; }
        public string? Title { get; set; }
        public string? Name { get; set; }
        public string? Email { get; set; }
        public string? CommentText { get; set; }
        public DateTime CreateDateTime { get; set; }
        public bool Edited { get; set; } = false;
        public bool IsFlagged { get; set; } = false;
        public CommentStatus? Status { get; set; }
        public string? UserId { get; set; } // Foreign key to User
        public User? User { get; set; }
    }

    public enum CommentStatus {
        Draft = 0,
        AwaitingModeration = 1,
        AwaitingEdit = 2,
        Approved = 3,
        UnderReview = 4,
        Rejected = 5,
        Archived = 6,
        Removed = 7,
        Spam = 8,
        Deleted = 9,
    }
}