using SmartSam.Comments.Lib;
using SmartSam.Comments.Data;

namespace SmartSam.Comments.Api.Models {
    public class CommentResponse {
        public required Comment Comment { get; set; }
        public List<Link> Links { get; set; } = new List<Link>();
    }
}
