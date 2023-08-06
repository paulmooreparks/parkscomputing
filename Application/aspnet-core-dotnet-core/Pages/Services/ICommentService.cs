namespace aspnet_core_dotnet_core.Pages.Services {
    public interface ICommentService {
        Comments GetComments(string pageId, bool enabled, bool allowed);
    }
}
