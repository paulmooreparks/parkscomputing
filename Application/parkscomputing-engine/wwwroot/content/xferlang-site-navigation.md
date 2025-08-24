---
title: Defining Site Navigation with XferLang
description: Replacing fragile JSON navigation with a friendlier, commentable, punctuation-light DSL
date: 2025-08-24T20:05:00+08
lastModified: 2025-08-24T20:05:00+08
commentsAllowed: false
commentsEnabled: false
lang: en-us
---

# Defining Site Navigation with XferLang

I moved my site navigation from JSON to **XferLang** to cut noise and make large editing passes safer. My original `sitenav.json` worked, but every change risked a trailing comma error, mis‑quoted excerpt, or awkward escaping. XferLang keeps the structural clarity while letting me focus on content.

## The Pain Points with JSON

| Need | JSON Friction |
|------|---------------|
| Optional commas? | No – every item except last needs a comma |
| Readable multi-line excerpts | Must escape quotes & newlines or collapse to one line |
| Comments / temporary removals | Not allowed – have to delete or invent ad‑hoc fields |
| Duplicate key aliases (e.g. `url` vs `link`) | Last one silently wins; easy to miss |
| Visual scan | Heavy punctuation: `{ } , : \"` everywhere |

A small JSON excerpt (simplified):

```json
{
  "slug": "home",
  "title": "Home",
  "nav": [
    { "slug": "applications", "description": "Client apps" },
    { "slug": "webapps", "description": "Web apps" }
  ],
  "posts": [
    {
      "slug": "sudoku",
      "excerpt": "I didn't like most of the Sudoku apps I found..."
    }
  ]
}
```

Editing a long excerpt means escaping quotes or switching to ugly `\n` sequences. Adding a node requires remembering commas in two places.

## The Same Structure in XferLang

Your current `sitenav.xfer` (trimmed):

```xferlang
{
    slug "home"
    title "Home"
    nav [
        {
            slug "applications"
            description "Here are some client-based applications I've written."
            nav [
                { slug "pbrain" }
                { slug "windragsens" }
            ]
        }
        {
            slug "webapps"
            description "Here are some web-based applications I've written."
            nav [
                { slug "sudoku" }
                { slug "barcode-generator" }
            ]
        }
    ]
    posts [
        {
            slug "sudoku"
            excerpt <"I didn't like most of the Sudoku apps I found, so I decided to write one...">
        }
    ]
}
```

Notable differences:

- No commas: lists are simple adjacency inside `[...]`.
- Key–value pairs: whitespace separates key and value (`slug "sudoku"`).
- Quoting rules are lenient; you only quote when needed.
- Long excerpts: angle‑bracket form `<" ... ">` lets you keep natural punctuation without escaping internal quotes.
- Easy commenting (XferLang supports comments, so you can annotate or temporarily disable sections) — something JSON flatly forbids.

## C# Model (`NavNode`)

```csharp
public class NavNode {
    public NavNode() => Nav = Array.Empty<NavNode>();

    [XferProperty("slug")] public string? Slug { get; set; }
    [XferProperty("title")] public string? Title { get; set; }
    [XferProperty("description")] public string? Description { get; set; }
    [XferProperty("excerpt")] public string? Excerpt { get; set; }

    // Unified URL (alias retained for backward compatibility)
    [XferProperty("url")] public string? Url { get; set; }
    [XferProperty("link")] public string? Link { get => Url; set { if (!string.IsNullOrWhiteSpace(value)) Url = value; } }

    [XferProperty("target")] public string? Target { get; set; }
    [XferProperty("date")] public DateTime? Date { get; set; }
    [XferProperty("updated")] public DateTime? Updated { get; set; }
    [XferProperty("order")] public int? Order { get; set; }
    [XferProperty("external")] public bool External { get; set; }

    public bool DerivedUrl { get; set; }

    [XferProperty("nav")] public NavNode[]? Nav { get; set; }
    [XferProperty("links")] public NavNode[]? Links { get => Nav; set { if (value != null) Nav = value; } }
    [XferProperty("posts")] public NavNode[]? Posts { get; set; }
}
```

## Deserializing the Navigation

```csharp
var path = Path.Combine(env.ContentRootPath, "wwwroot", "sitenav.xfer");
var text = File.ReadAllText(path);
NavNode root = XferConvert.Deserialize<NavNode>(text) ?? new NavNode { Slug = "root" };
```

## Post-Processing & URL Derivation

If a node omits `url`, we derive one based on whether it has children:

```csharp
void AssignDerived(NavNode node, bool isRoot = false) {
    if (string.IsNullOrWhiteSpace(node.Slug)) return;

    if (!string.IsNullOrWhiteSpace(node.Url)) {
        if (Uri.TryCreate(node.Url, UriKind.Absolute, out var abs) &&
            (abs.Scheme == Uri.UriSchemeHttp || abs.Scheme == Uri.UriSchemeHttps)) {
            node.External = true;
        }
    } else if (!isRoot) {
        bool hasChildren = node.Nav?.Length > 0;
        node.Url = hasChildren ? $"/nav/{node.Slug}" : $"/page/{node.Slug}";
        node.DerivedUrl = true;
    }

    if (node.Nav != null)
        foreach (var c in node.Nav) AssignDerived(c);
}
```

## Enriching Metadata from Content

Markdown front matter + first paragraph fill gaps:

```csharp
foreach (var post in root.Posts ?? Array.Empty<NavNode>()) {
    if (!post.DerivedUrl) continue;            // explicit URLs left alone
    bool missing = string.IsNullOrWhiteSpace(post.Title)
                   || string.IsNullOrWhiteSpace(post.Description)
                   || string.IsNullOrWhiteSpace(post.Excerpt)
                   || !post.Date.HasValue
                   || !post.Updated.HasValue;
    if (!missing) continue;

    TryEnrichFromMarkdown(post) || TryEnrichFromHtml(post);

    if (!post.Updated.HasValue && post.Date.HasValue)
        post.Updated = post.Date;
}
```

## Why This Feels Better Day‑to‑Day

- Add a node → paste a brace block; no mental diff of commas.
- Reorder lists → just move blocks.
- Jot a TODO comment beside an item (JSON: impossible).
- Embed a long excerpt without escaping internal quotes.
- Aliases (`links`, `link`) preserved via `[XferProperty]` without double keys colliding.

## Next Sections To Add Later

- Comment syntax examples
- Multi-line literal variations
- Validation / linting ideas
- Generating a sitemap or breadcrumb trail from the same tree

---

(End of starter draft.)
