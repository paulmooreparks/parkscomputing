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

## Open questions

1. **Analytics and advertising.** The current site loads Google Analytics, Google Site Kit and Google Ads remarketing tags. If Padma is not running advertising, the new site leaves out every Google tag and uses Plausible, which sets no cookies; the cookie policy then shrinks to a statement that the site sets only the cookies sign-in needs, and the site needs no consent banner. If she is advertising, the tags and a consent banner stay.
2. **The engine work comes first.** Step 1 is a refactor of parkscomputing.com's engine, which every later step depends on, and it gets its own review before content is converted.
