using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Identity;

/// <summary>A signed-in reader's pins (Architecture/pins-design.md). The page
/// carries them as it is drawn; this reads them again and saves a change.</summary>
[ApiController, Route("api/account/pins"), AutoValidateAntiforgeryToken]
public sealed class PinsController : ControllerBase {
    private readonly AccountPins _pins; private readonly UserManager<IdentityUser> _users; private readonly AccountOptions _options;
    public PinsController(AccountPins pins, UserManager<IdentityUser> users, IOptions<AccountOptions> options) {
        _pins = pins; _users = users; _options = options.Value;
    }

    public sealed record Body(List<Pin?>? Pins);

    [HttpGet]
    public async Task<IActionResult> Get() {
        var id = _options.Enabled ? _users.GetUserId(User) : null;
        if (id is null) { return Unauthorized(new { signin = true }); }
        Response.Headers.CacheControl = "no-cache, no-store";
        return Ok(new { pins = await _pins.GetAsync(id) });
    }

    [HttpPut]
    public async Task<IActionResult> Put([FromBody] Body body) {
        var id = _options.Enabled ? _users.GetUserId(User) : null;
        if (id is null) { return Unauthorized(new { signin = true }); }
        var pins = AccountPins.Clean(body.Pins);
        if (pins is null) { return BadRequest(new { error = "Those aren't pins this site can keep." }); }
        try { await _pins.SetAsync(id, pins); }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
        return Ok(new { pins });
    }
}
