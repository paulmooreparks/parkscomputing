using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.RazorPages;

using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.Pages.Admin;

/// <summary>
/// A workspace page on the edit origin: one applet, with the admin mount
/// (Architecture/admin-and-identity-design.md, A7). The page itself is only
/// the mount point; Pages/Shared/_AdminLayout.cshtml loads the applets and
/// names the mount.
/// </summary>
[Authorize(Roles = AdminOptions.Role)]
public class WorkspaceModel : PageModel {
    public void OnGet() { }
}

public sealed class FilesModel : WorkspaceModel { }
public sealed class TerminalModel : WorkspaceModel { }
public sealed class EditorModel : WorkspaceModel { }
