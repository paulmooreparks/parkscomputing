using System.ComponentModel.DataAnnotations;
using System.Reflection;

using SmartSam.Comments.Lib;

namespace ParksComputing.Engine.Pages.Services {
    public class CommentForm {
        [StringLength(100, ErrorMessage = "Name may not contain more than 100 characters.")]
        public required string Name { get; set; }
        [EmailAddress]
        public required string Email { get; set; }
        [StringLength(100, ErrorMessage = "Title may not contain more than 100 characters.")]
        public string? Title { get; set; } = string.Empty;
        [StringLength(4000, ErrorMessage = "Comment text may not contain more than 4000 characters.")]
        public required string Text { get; set; }
        public Comment ToComment(string domain, string pageId) {
            return new Comment {
                Name = Name,
                Email = Email,
                Title = Title,
                CommentText = Text,
                Domain = domain,
                PageId = pageId
            };
        }
    }
}
