using System;
using System.Security.Cryptography;
using System.Text;

using Microsoft.AspNetCore.Mvc;

using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.Controllers;

/// <summary>
/// /applets/registry.js: the define() of every installed applet package
/// (Pages/Services/AppletCatalog.cs), which the layouts load after
/// js/applets.js. It is written on each request from the catalogue, which
/// reads the folder again only when a manifest changes, and a browser keeps
/// it by its ETag, so an installed package shows on the next page load.
/// </summary>
[Route("applets/registry.js")]
public sealed class AppletRegistryController : ControllerBase {
    private readonly AppletCatalog _catalog;

    public AppletRegistryController(AppletCatalog catalog) { _catalog = catalog; }

    [HttpGet]
    public IActionResult Get() {
        var script = _catalog.RegistryScript();
        var tag = "\"" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(script)))[..24].ToLowerInvariant() + "\"";
        Response.Headers.CacheControl = "public, no-cache";
        Response.Headers.ETag = tag;
        if (Request.Headers.IfNoneMatch.Count > 0 && Request.Headers.IfNoneMatch.ToString() == tag) { return StatusCode(304); }
        return Content(script, "text/javascript; charset=utf-8");
    }
}
