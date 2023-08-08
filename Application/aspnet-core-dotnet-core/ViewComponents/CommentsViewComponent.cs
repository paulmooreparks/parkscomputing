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

        async public Task<IViewComponentResult> InvokeAsync(string pageId, bool commentsEnabled, bool commentsAllowed) {
            var commentResponses = await _commentService.GetCommentsAsync(pageId, commentsEnabled, commentsAllowed);
            return View(commentResponses);
        }
    }
}
