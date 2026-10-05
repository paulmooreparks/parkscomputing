# Moving padmajairam.com onto the engine

Paul decided on 5 October 2026 to move padmajairam.com, the site of Padma Jairam's counselling psychology practice in Singapore, from WordPress to the engine that serves parkscomputing.com. This document records the plan and the decisions made so far. The canonical [Architectural Principles](<C:/Users/paul/OneDrive/Documents/Architectural Principles.md>) apply.

## Why move

The site is served from a WordPress container on BARN (`C:\Users\paul\wordpress-padmajairam`, port 8085) through the Cloudflare tunnel, and it is very slow. On 5 October 2026 the live home page took 8.2 seconds before its first byte and the About page 7.7 seconds; the local copy answers in about 5 seconds. Almost all of that is the server. Every request makes PHP read hundreds of files from `wp-content`, which is bind-mounted from the Windows disk into the container, and file reads across that boundary are slow under Docker on Windows. The page then loads 48 stylesheets, 53 scripts and Google's advertising tags. The engine serves parkscomputing.com from the same machine quickly, and Paul finds it easier to edit than WordPress.

## What there is to move

The WordPress export of 11 November 2025 is in `wordpress-padmajairam\backups`, and the live database is newer. The local WordPress answers its REST API at `http://localhost:8085/wp-json/`. On 5 October 2026 it held these items:

- Nine pages: the home page (`padma-jairam-counselling-psychologist`), About, Contact, Directions, FAQ, CV, Articles, the privacy policy (`privacy-policy-2`) and the cookie policy.
- Eight posts, from April 2021 to June 2026.
- The images actually used, from 46 attachments in `wp-uploads` (46 MB in all, most of it in sizes no page uses).
- The Yoast titles and descriptions, and the structured data (`schema`) that a plugin adds.

The site has no forms. Its contact details are a phone number, WhatsApp, LinkedIn and email, and the office is at Redwood Psychology, shown with an embedded Google map.

An earlier attempt at the move, from October 2025, is in `C:\Users\paul\OneDrive\Documents\padmajairam.com`. It is a year out of date (it lacks the CV page and three of the posts) and carries leftover parkscomputing files, so it serves only as a reference. The `padmajairam-local:dev` image and the `padmajairam` service in `docker-compose.yml` come from the engine as it was before PUDL, and both will be replaced.

## Decisions

### Editing is through the site's own administration

Paul decided that editing works as it does with WordPress today: someone browses to `/admin` on padmajairam.com and signs in. Paul is the site's super-user and Padma is an Admin. In practice Paul makes nearly every edit, and Padma edits rarely.

This matches the roles the engine already has (`unified-identity-design.md`, "Roles, capabilities and super-admin bootstrap"). An Admin creates, edits and publishes ordinary articles. The super-user can also change the site's code and settings and use the server tools: Files, the Editor and the terminal. Sign-in uses passkeys, with an emailed link as the fallback, as on parkscomputing.com.

The site has its own accounts database (`PadmaJairamSite`, as the compose file already says), so an account on one site is not an account on the other. Public sign-up is off, so the only accounts are the two staff accounts, created through the same host-only bootstrap that made Paul super-user on parkscomputing.com. Comments are off.

### Addresses stay as they are

WordPress serves every page and post at the top level with a trailing slash, such as `/about/` and `/it-is-okay-to-be-just-okay/`. The engine will serve the same addresses, so links from elsewhere and search rankings carry over. The home page is `/`, and the address without the trailing slash redirects to the one with it. Any address that has to change gets a permanent redirect.

## Plan

### 1. A site-neutral engine

About 30 files in the engine name Parks Computing or parkscomputing.com, and the window view is the home page. Each site's identity moves into its own configuration and sitenav: its name, logo, the menu's label, footer, contact details and analytics domain. Each site also says which features it has. padmajairam.com has the classic view only, with no window view, applets, comments or public sign-up, and has staff sign-in at `/admin`. parkscomputing.com must look and behave exactly as before, which the existing browser tests check.

Each feature a site leaves out is absent from its pages, from its menus and from its routes, rather than present but hidden.

### 2. Content conversion

A one-off script reads the WordPress pages and posts and writes each as Markdown with front matter: title, date, description, the Yoast title where it differs, and the address. WordPress block markup becomes plain Markdown, or HTML where Markdown cannot say the same thing, such as a figure with a caption. The script copies only the images the content uses, at the sizes it uses them, as WebP. Each converted page is then compared by eye with the WordPress page.

### 3. Look

The site gets its own PUDL theme matched to the present design: the teal bar, the lotus logo, and the dark footer. PUDL's cards suit the "You Might Be Here Because…" sections, and its notices suit announcements such as the move to Redwood Psychology. The header keeps the phone number and the LinkedIn, WhatsApp and email links.

### 4. What search engines see

The site keeps its titles, descriptions, `sitemap.xml`, structured data, canonical links and social-sharing tags.

### 5. Beta, review and cutover

The engine version and the converted content run first on a beta address for Paul and Padma to review. The cutover changes the tunnel's route from the WordPress container to the engine. WordPress stays stopped but intact for two weeks, so going back is one change to the tunnel.

### No advertising, so no Google tracking

Padma is not advertising (Paul, 5 October 2026). The new site carries none of the Google Analytics, Site Kit or Ads tags, and counts visits with Plausible, which sets no cookies. The cookie policy can therefore shrink to a statement of the cookies sign-in needs, and the site needs no consent banner. The Google map on the home and Directions pages is the one Google element left, and whether it stays as an embed or becomes a link to the map is still to be decided.

### The look keeps her layout, made to PUDL's rules

Padma likes the present layout and colours, so the new site keeps them: the light header with the lotus logo, phone number and contact links, the teal bar of places, the page on a panel over the grey background with Recent Thoughts beside it, and the black footer. PUDL's palette tokens carry her colours (teal `#367588` as the accent, the `#cccccc` page, Lato as the face), and PUDL's rules give links their underline, mark the reader's place in the bar with a bar and bold text rather than colour alone, and keep the panels flat, since they display and are not pressed.

The readers include people living with anxiety, depression, OCD and other conditions, so the page asks as little of them as it can. It has one calm palette, with the purple hover and the orange buttons of the old theme gone; no motion, pop-ups or consent banner; text at 17 pixels in lines of at most 72 characters; a skip link; and the same places in the same order on every page.

## The first preview, 5 October 2026

The engine gained a brochure mode, set by configuration, which leaves parkscomputing.com as it was:

- `Site:Mode=brochure` puts the site's home page (`content/index`) at `/` in place of the window view, sends `/home` to `/`, and gives every page `Pages/Shared/_BrochureLayout.cshtml` in place of `_Layout` (`Pages/Services/BrochureLayoutExpander.cs`). The layout belongs to no one site: its header, footer, fonts, stylesheet and analytics come from the site's `content/head-section.html`, `header-section.html` and `footer-section.html`, its bar from the top level of `sitenav.xfer`, and its Recent list from the first feed section.
- `Site:PageUrl=/{slug}/` gives each page in the navigation WordPress's address (`Pages/Services/SiteOptions.cs`, used by `NavService`).
- On a brochure site only an article, an entry of a feed section, shows its date and tags.
- The engine's old built-in `/about` and `/contact` pages, which held Paul's text from before the content files, are gone, since they would have answered her `/about/` and `/contact/`. On parkscomputing.com `/about` now shows `content/about.md`, and `/contact` has no page.

Her content is in `C:\Users\paul\OneDrive\Documents\padmajairam.com\wwwroot`, converted by `tools\convert.js` beside it from the WordPress REST API: eight pages and eight articles as HTML content files with their titles, descriptions and dates, ten images as WebP (651 KB in all), the Thoughts page listing the articles, and `sitenav.xfer`. The earlier attempt is set aside in `wwwroot-2025-attempt`. Her own stylesheet is `css/site.css`.

The preview runs from the image `padmajairam-local:preview` as the container `padmajairam-preview` on `http://localhost:8089`, with no accounts, the content mounted read-only, and the accounts database `PadmaJairamSite`. Its pages begin to arrive in about 20 milliseconds, against 8 seconds for the WordPress site.

### Readable by AI

The WordPress site used the RankReady plugin to give each page as Markdown and to count AI crawlers' visits. The engine now does both itself, for any site it serves:

- `/llms.txt`, in the form llmstxt.org proposes, gives the site's name and description from `sitenav.xfer` and lists every page's Markdown: the top-level pages, then each section's pages under its own heading, then any other content page, such as the policies, under Optional. A site that writes its own `llms.txt` in wwwroot has that served instead.
- Each page's Markdown is at its own address with `.md` added (`/about.md`, `/index.md` for the home page, `/page/about.md` on parkscomputing.com), headed by its title, description, address and date (`Pages/Services/MarkdownPages.cs`, `Api/MarkdownController.cs`). A Markdown page is given as written; an HTML page is converted with ReverseMarkdown. Layout parts (`-section` files) and applet pages have none. The response carries a canonical link to the page and `noindex`, so search engines keep the page itself. The brochure layout points to it with `<link rel="alternate" type="text/markdown">`.
- A request from a known AI agent, recognised by the name its operator publishes in the user agent (OpenAI's GPTBot and ChatGPT-User, Anthropic's ClaudeBot and Claude-User, PerplexityBot, Meta's agents, Bytespider, CCBot and others), and any request for `llms.txt` or a page's Markdown, is counted by day, agent and address in `SiteAiVisits` (`Identity/AiVisits.cs`). Counting is in memory and written once a minute; no address or other detail of the requester is kept. `admin ai-visits [days]` on the server prints the totals until the site has a page for them.

Not yet done: sign-in at `/admin` for Paul and Padma, an editing path for an Admin (the engine's article workspace edits database revisions, not the content files the site serves), canonical links and the trailing-slash redirect, `sitemap.xml`, structured data and social-sharing tags, the cookie policy's rewrite, the map decision, and the Thoughts list built from the navigation rather than written into the page.
