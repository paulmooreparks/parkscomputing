using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// Serves profile pictures (Identity/AccountAvatars.cs). A picture is
/// public, as it will stand beside its owner's comments, and the same for
/// every reader, so the address that names its version may be cached by
/// anyone for good. The bytes go out with the type their own header showed,
/// nosniff, and a sandbox policy, so they are only ever a picture.
/// </summary>
[ApiController]
public sealed class AvatarController : ControllerBase {
    private readonly AccountAvatars _avatars;
    private readonly AccountOptions _accounts;

    public AvatarController(AccountAvatars avatars, IOptions<AccountOptions> accounts) {
        _avatars = avatars; _accounts = accounts.Value;
    }

    [HttpGet("avatars/{userId}")]
    public async Task<IActionResult> Get(string userId, [FromQuery] string? v) {
        if (!_accounts.Enabled || userId.Length > 450) { return NotFound(); }
        var avatar = await _avatars.GetAsync(userId);
        if (avatar is not { } a) { return NotFound(); }
        var h = Response.Headers;
        h["X-Content-Type-Options"] = "nosniff";
        h["Content-Security-Policy"] = "default-src 'none'; sandbox";
        h["Cache-Control"] = string.Equals(v, a.Version.ToString("N"), StringComparison.OrdinalIgnoreCase)
            ? "public, max-age=31536000, immutable" : "no-cache";
        return File(a.Image, a.Type);
    }
}
