using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace SmartSam.Comments.Lib {
    public class CommentResponse {
        public required Comment Comment { get; set; }
        public List<Link> Links { get; set; } = new List<Link>();
    }
}
