using System.Collections.Generic;
using SmartSam.Comments.Lib;

namespace aspnet_core_dotnet_core.Pages.Services {
    public class Comments {
        public bool Enabled { get; set; }
        public bool Allowed { get; set; }
        public List<Comment> CommentList { get; set; }
    }
}
