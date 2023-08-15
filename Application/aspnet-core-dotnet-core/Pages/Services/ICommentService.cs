using System.Collections.Generic;
using System.Threading.Tasks;

using SmartSam.Comments.Lib;

namespace aspnet_core_dotnet_core.Pages.Services {
    public interface ICommentService {
        Task<Comments> GetCommentsAsync(string pageId, bool commentsEnabled, bool commentsAllowed, bool commentPosted);
    }
}
