using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc.Formatters;
using Microsoft.Net.Http.Headers;
using System.IO;

namespace ParksComputing.Engine.Xfer {
    public class XferInputFormatter : TextInputFormatter {
        private readonly IXferService _xfer;
        public XferInputFormatter(IXferService xfer) {
            _xfer = xfer;
            SupportedMediaTypes.Add(MediaTypeHeaderValue.Parse(XferService.ApplicationXfer));
            SupportedEncodings.Add(System.Text.Encoding.UTF8);
            SupportedEncodings.Add(System.Text.Encoding.Unicode);
        }

        protected override bool CanReadType(Type type) => true; // allow model binding to decide

        public override async Task<InputFormatterResult> ReadRequestBodyAsync(InputFormatterContext context, System.Text.Encoding encoding) {
            try {
                var obj = await _xfer.DeserializeAsync(context.HttpContext.Request.Body, context.ModelType);
                return await InputFormatterResult.SuccessAsync(obj);
            } catch (Exception ex) {
                // Provide concise error plus first 80 chars of payload for debugging (without leaking full secrets)
                context.HttpContext.Request.Body.Position = 0;
                using var reader = new StreamReader(context.HttpContext.Request.Body, System.Text.Encoding.UTF8, detectEncodingFromByteOrderMarks: true, leaveOpen: true);
                string raw = await reader.ReadToEndAsync();
                string preview = raw.Length <= 80 ? raw : raw.Substring(0, 80) + "…";
                context.ModelState.TryAddModelError(context.ModelName, $"Xfer parse error: {ex.GetType().Name}: {ex.Message} | preview: {preview}");
                return await InputFormatterResult.FailureAsync();
            }
        }
    }
}
