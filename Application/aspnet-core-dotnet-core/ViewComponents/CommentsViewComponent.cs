using System.Threading.Tasks;

using aspnet_core_dotnet_core.Pages.Services;

using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Hosting;

namespace aspnet_core_dotnet_core.ViewComponents {
    public class CommentsViewComponent : ViewComponent {
        private IHostEnvironment Environment { get; set; }
        private ICommentService _commentService;

        public CommentsViewComponent(ICommentService commentService) {
            _commentService = commentService;
        }

        public IViewComponentResult Invoke(string pageId, bool enabled, bool allowed) {
            return View(_commentService.GetComments(pageId, enabled, allowed));
        }
    }
}
