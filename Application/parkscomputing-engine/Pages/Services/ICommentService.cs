using System.Collections.Generic;
using System.Threading.Tasks;


namespace ParksComputing.Engine.Pages.Services {
    public interface ICommentService {
        Task<Comments> GetCommentsAsync(string pageId, bool commentsEnabled, bool commentsAllowed, bool commentPosted);
    }
}
