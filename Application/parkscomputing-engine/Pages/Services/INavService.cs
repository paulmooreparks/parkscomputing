using System.Threading.Tasks;

namespace ParksComputing.Engine.Pages.Services {
    public interface INavService {
        NavNode GetRoot();
        NavNode? GetNavNode(string slug);
    }
}
