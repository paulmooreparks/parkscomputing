using System.Threading.Tasks;

namespace aspnet_core_dotnet_core.Pages.Services {
    public interface INavService {
        NavRoot GetNavRoot();
        NavNode GetNavNode(string key);
    }
}
