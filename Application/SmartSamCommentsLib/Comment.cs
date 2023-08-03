using System.ComponentModel;

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
        [Description("Draft that has not been submitted")]
        Draft = 0,

        [Description("Submitted but not yet approved by moderator")]
        AwaitingModeration = 1,
        
        [Description("Moderated but requires edit before approval")]
        AwaitingEdit = 2,
        
        [Description("Approved for publishing")]
        Approved = 3,
        
        [Description("Previously published but now under review")]
        UnderReview = 4,
        
        [Description("Rejected during approval or review process")]
        Rejected = 5,
        
        [Description("Archived and no longer published")]
        Archived = 6,
        
        [Description("Rejected as spam")]
        Spam = 7,
        
        [Description("Deleted")]
        Deleted = 8,
    }
}