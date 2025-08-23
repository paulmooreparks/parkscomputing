using System.Threading.Tasks;

namespace ParksComputing.Engine.Pages.Services {
    public interface INavService {
        NavRoot GetNavRoot();
        NavNode GetNavNode(string key);
    }
}
