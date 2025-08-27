using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace ParksComputing.Engine.Api {
    public interface IContentStorage {
        Task<ContentResource?> GetAsync(string id, CancellationToken ct = default);
        Task<IReadOnlyList<ContentResource>> ListAsync(string? prefix = null, CancellationToken ct = default);
        Task<ContentResource> UpsertAsync(ContentResource resource, string? expectedETag = null, CancellationToken ct = default);
        Task<bool> DeleteAsync(string id, string? expectedETag = null, CancellationToken ct = default);
    }
}
