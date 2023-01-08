using System;
using System.Threading.Tasks;

namespace aspnet_core_dotnet_core.Pages.Services {
    public interface INavService {
        NavRoot GetNavRoot();
        NavNode GetNavNode(string key);
    }

    public struct NavRoot {
        public NavNode nav { get; set; }
        public NavNode[] posts { get; set; }
    }

    public struct NavNode {
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
