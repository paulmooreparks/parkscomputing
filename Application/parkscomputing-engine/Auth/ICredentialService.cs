using System.Threading.Tasks;

namespace ParksComputing.Engine.Auth {
    public interface ICredentialService {
        Task<bool> ValidateAsync(string username, string password);
    }
}
