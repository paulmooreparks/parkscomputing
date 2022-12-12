using System.Threading.Tasks;

using Microsoft.Extensions.Hosting;

using Newtonsoft.Json;

namespace aspnet_core_dotnet_core.Pages.Services {
    public class NavService : INavService {
        private IHostEnvironment Environment { get; set; }

        public NavService(IHostEnvironment environment) {
            Environment = environment;
        }

        public NavNode GetNavNode(string key) {
            throw new System.NotImplementedException();
        }

        public NavRoot GetNavRoot() {
            var path = $"{Environment.ContentRootPath}/wwwroot/sitenav.json";
            var json = System.IO.File.ReadAllText(path);
            var navRoot = JsonConvert.DeserializeObject<NavRoot>(json);
            return navRoot;
        }
    }
}
