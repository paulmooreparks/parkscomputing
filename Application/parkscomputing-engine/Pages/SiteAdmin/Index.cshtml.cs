using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using ParksComputing.Engine.Identity;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.Pages.SiteAdmin;

/// <summary>/admin/pages: the pages the reader may edit, and for the
/// super-user the site's own files.</summary>
public sealed class IndexModel : SiteAdminModel {
    public IndexModel(SiteEditor editor, StaffAccess staff, IOptions<AccountOptions> accounts, IOptions<SiteOptions> site)
        : base(editor, staff, accounts, site) { }

    public IReadOnlyList<EditableFile> Files { get; private set; } = new List<EditableFile>();

    public async Task<IActionResult> OnGetAsync() {
        if (await GateAsync() is { } away) { return away; }
        Files = Editor.Files(Superuser);
        return Page();
    }
}
