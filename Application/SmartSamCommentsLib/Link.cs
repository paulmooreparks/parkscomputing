using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace SmartSam.Comments.Lib {
    public class Link {
        public required string Rel { get; set; }
        public required string Method { get; set; }
        public required string? Href { get; set; }
    }
}
