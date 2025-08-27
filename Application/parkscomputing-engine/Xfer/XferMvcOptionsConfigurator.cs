using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Xfer {
    // Safely inject formatters without building a nested service provider.
    public class XferMvcOptionsConfigurator : IConfigureOptions<MvcOptions> {
        private readonly XferInputFormatter _input;
        private readonly XferOutputFormatter _output;
        public XferMvcOptionsConfigurator(XferInputFormatter input, XferOutputFormatter output) {
            _input = input; _output = output;
        }

        public void Configure(MvcOptions options) {
            if (!options.InputFormatters.Contains(_input)) {
                options.InputFormatters.Insert(0, _input);
            }
            if (!options.OutputFormatters.Contains(_output)) {
                options.OutputFormatters.Insert(0, _output);
            }
        }
    }
}
