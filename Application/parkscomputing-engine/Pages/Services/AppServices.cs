using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

using System.Net.Http;

namespace ParksComputing.Engine.Pages.Services {
    public class AppServices {
        public INavService NavService { get; }
        public ICommentService CommentService { get; }
        public IHostEnvironment Environment { get; }
        public IHttpClientFactory ClientFactory { get; }
        public IOptions<CommentServiceConfig> CommentServiceConfig { get; }

        public AppServices(IOptions<CommentServiceConfig> commentServiceConfig, INavService navService, ICommentService commentService, IHostEnvironment environment, IHttpClientFactory clientFactory) {
            CommentServiceConfig = commentServiceConfig;
            NavService = navService;
            CommentService = commentService;
            Environment = environment;
            ClientFactory = clientFactory;
        }
    }
}
