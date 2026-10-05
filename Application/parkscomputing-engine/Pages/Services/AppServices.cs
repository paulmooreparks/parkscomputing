using Microsoft.Extensions.Hosting;
using Microsoft.AspNetCore.Hosting;

using System.Net.Http;

namespace ParksComputing.Engine.Pages.Services {
    public class AppServices {
        public INavService NavService { get; }
        public IWebHostEnvironment Environment { get; }
        public IHttpClientFactory ClientFactory { get; }

        public AppServices(INavService navService, IWebHostEnvironment environment, IHttpClientFactory clientFactory) {
            NavService = navService;
            Environment = environment;
            ClientFactory = clientFactory;
        }
    }
}
