using System;
using System.IO;
using ParksComputing.Xfer.Lang;
using ParksComputing.Xfer.Lang.Elements;
using ParksComputing.Xfer.Lang.Services;
using System.Threading;
using System.Text;
using System.Threading.Tasks;

// XferService: thin abstraction over the ParksComputing.Xfer.Lang library so the rest of the
// application depends only on this interface. If the underlying package API shifts we confine
// adjustments here.
namespace ParksComputing.Engine.Xfer {
    public interface IXferService {
        string MediaType { get; }
        // Generic preferred APIs
        string Serialize<T>(T value, bool compact = false);
        Task<string> SerializeAsync<T>(T value, bool compact = false, CancellationToken ct = default);
        T? Deserialize<T>(string text);
        Task<T?> DeserializeAsync<T>(Stream stream, CancellationToken ct = default);
        // Non‑generic convenience (used by formatters / legacy call sites). Avoid reflection by using dynamic.
        string Serialize(object? value, Type type);
        Task<string> SerializeAsync(object? value, Type type, CancellationToken ct = default);
        object? Deserialize(string text, Type type);
        Task<object?> DeserializeAsync(Stream stream, Type type, CancellationToken ct = default);
    }

    public class XferService : IXferService {
        public const string ApplicationXfer = "application/xfer";
        public string MediaType => ApplicationXfer;

        // Generic implementations (direct calls, no reflection)
    public string Serialize<T>(T value, bool compact = false) => value == null ? string.Empty : XferConvert.Serialize(value, compact ? Formatting.None : Formatting.Pretty);
        public async Task<string> SerializeAsync<T>(T value, bool compact = false, CancellationToken ct = default) {
            if (value == null) { return string.Empty; }
            using var writer = new StringWriter();
            await XferConvert.SerializeAsync(value, writer, compact ? Formatting.None : Formatting.Pretty, ct);
            return writer.ToString();
        }
        public T? Deserialize<T>(string text) => XferConvert.Deserialize<T>(text);
        public async Task<T?> DeserializeAsync<T>(Stream stream, CancellationToken ct = default) {
            using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true, leaveOpen: true);
            var txt = await reader.ReadToEndAsync();
            return XferConvert.Deserialize<T>(txt);
        }
        // Non-generic shims
        public string Serialize(object? value, Type type) {
            if (value == null) { return string.Empty; }
            // dynamic lets runtime pick the closed generic Serialize<T>(T,Formatting)
            return XferConvert.Serialize((dynamic)value, Formatting.Pretty);
        }
        public async Task<string> SerializeAsync(object? value, Type type, CancellationToken ct = default) {
            if (value == null) { return string.Empty; }
            using var writer = new StringWriter();
            await XferConvert.SerializeAsync((dynamic)value, writer, Formatting.Pretty, ct);
            return writer.ToString();
        }
        public object? Deserialize(string text, Type type) => XferConvert.Deserialize(text, type);
        public async Task<object?> DeserializeAsync(Stream stream, Type type, CancellationToken ct = default) {
            using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true, leaveOpen: true);
            var txt = await reader.ReadToEndAsync();
            return XferConvert.Deserialize(txt, type);
        }
    }
}
