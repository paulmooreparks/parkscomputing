using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace SmartSam.Comments.Lib {
    public class User {
        public string? UserId { get; set; }
        public string? Domain { get; set; }
        public string? Name { get; set; }
        public string? Email { get; set; }
        public DateTime CreateDateTime { get; set; }
        public List<Comment>? Comments { get; set; }
    }
}
