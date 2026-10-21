using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using ParksComputing.XferLang.Serialization;

// XferService: thin abstraction over the XferLang 1.0 library (ParksComputing.XferLang) so the
// rest of the application depends only on this interface. If the underlying package API shifts
// we confine adjustments here.
//
// XferLang 1.0 writes one form, the canonical one, so there is no compact or pretty choice to
// make; the 0.x library's compact option is gone with it (Architecture/xferlang-1.0-migration.md).
// A null value is written as the empty string, as it was before, rather than the library's
// "null" line.
namespace ParksComputing.Engine.Xfer {
    public interface IXferService {
        string MediaType { get; }
        // Generic preferred APIs
        string Serialize<T>(T value);
        Task<string> SerializeAsync<T>(T value, CancellationToken ct = default);
        T? Deserialize<T>(string text);
        Task<T?> DeserializeAsync<T>(Stream stream, CancellationToken ct = default);
        // Non-generic convenience, used by the formatters.
        string Serialize(object? value, Type type);
        Task<string> SerializeAsync(object? value, Type type, CancellationToken ct = default);
        object? Deserialize(string text, Type type);
        Task<object?> DeserializeAsync(Stream stream, Type type, CancellationToken ct = default);
    }

    public class XferService : IXferService {
        public const string ApplicationXfer = "application/xfer";
        public string MediaType => ApplicationXfer;

        public string Serialize<T>(T value) => value == null ? string.Empty : XferSerializer.Serialize(value);

        public Task<string> SerializeAsync<T>(T value, CancellationToken ct = default) => Task.FromResult(Serialize(value));

        public T? Deserialize<T>(string text) => XferSerializer.Deserialize<T>(text);

        public async Task<T?> DeserializeAsync<T>(Stream stream, CancellationToken ct = default) =>
            XferSerializer.Deserialize<T>(await ReadAllAsync(stream, ct));

        public string Serialize(object? value, Type type) => value == null ? string.Empty : XferSerializer.Serialize(value, type);

        public Task<string> SerializeAsync(object? value, Type type, CancellationToken ct = default) => Task.FromResult(Serialize(value, type));

        public object? Deserialize(string text, Type type) => XferSerializer.Deserialize(text, type);

        public async Task<object?> DeserializeAsync(Stream stream, Type type, CancellationToken ct = default) =>
            XferSerializer.Deserialize(await ReadAllAsync(stream, ct), type);

        private static async Task<string> ReadAllAsync(Stream stream, CancellationToken ct) {
            using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true, leaveOpen: true);
            return await reader.ReadToEndAsync(ct);
        }
    }
}
