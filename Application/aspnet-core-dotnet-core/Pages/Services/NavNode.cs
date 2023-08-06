using System;

namespace aspnet_core_dotnet_core.Pages.Services {
    public class NavNode {
        public string key { get; set; }
        public string title { get; set; }
        public string description { get; set; }
        public string excerpt { get; set; }
        public string link { get; set; }
        public string target { get; set; }
        public DateTime date { get; set; }
        public NavNode[] links { get; set; } 

        public NavNode() {
           links = new NavNode[0];
        }
    }
}
