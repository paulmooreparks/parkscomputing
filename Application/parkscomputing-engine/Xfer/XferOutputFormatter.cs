using System;
using System.Threading.Tasks;
using System.IO.Pipelines;
using System.Text;
using Microsoft.AspNetCore.Mvc.Formatters;
using Microsoft.Net.Http.Headers;

namespace ParksComputing.Engine.Xfer {
    public class XferOutputFormatter : TextOutputFormatter {
        private readonly IXferService _xfer;
        public XferOutputFormatter(IXferService xfer) {
            _xfer = xfer;
            SupportedMediaTypes.Add(MediaTypeHeaderValue.Parse(XferService.ApplicationXfer));
            SupportedEncodings.Add(System.Text.Encoding.UTF8);
        }

        protected override bool CanWriteType(Type? type) => true; // Provide Xfer for any response when negotiated

        public override async Task WriteResponseBodyAsync(OutputFormatterWriteContext context, System.Text.Encoding selectedEncoding) {
            var text = _xfer.Serialize(context.Object, context.ObjectType ?? context.Object?.GetType() ?? typeof(object));
            context.HttpContext.Response.ContentType = XferService.ApplicationXfer;
            var bytes = selectedEncoding.GetBytes(text ?? string.Empty);
            await context.HttpContext.Response.Body.WriteAsync(bytes, 0, bytes.Length);
        }
    }
}
