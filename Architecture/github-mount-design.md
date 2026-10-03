# GitHub repositories in the site's file system

Paul asked on 2026-10-01 for GitHub repositories to be mountable in the site's file system (`js/sitefs.js`), so that a repository can be browsed in Files, in the terminal, in the Editor and in the Diff Viewer, with sign-in from the start. This is the design, and it is proposed, not settled; the decisions still open are at the end.

## What the reader sees

- `/github` is a directory at the root of the file system, beside `/site`, `/bin` and `/home`. A mounted repository is `/github/owner/repo`, at the branch or tag it was mounted at.
- Mounting is something the reader does: `github mount paulmooreparks/pudl` (or `…@v0.38.0`) in the terminal, or "Mount a GitHub repository…" in Files. The file system resolves paths synchronously, so a repository's listing is fetched once when it is mounted, and every path in it resolves at once after that.
- The mounted repositories are remembered (in this browser on the public site, in `~/.config` on the admin site) and mounted again on the next visit.
- Everything under `/github` is read-only. Copying a file into `~` works as it does from `/site`.
- `github unmount`, `github refresh` and `github status` (signed in or not, and the calls left this hour) round out the terminal command; Files offers the same.

## How it reads GitHub

- **Listing**: one call per repository, `GET /repos/{owner}/{repo}/git/trees/{ref}?recursive=1`, which returns every path with its size and blob SHA. A repository too large for one response (the API marks it truncated) is mounted with what came back and says so.
- **Files**: `GET /repos/{owner}/{repo}/contents/{path}?ref={sha}` with the raw media type. A blob's SHA names its content for ever, so each file read is kept in the browser by SHA and never fetched twice.
- **Without sign-in** the browser calls the GitHub API directly; GitHub documents that its API supports cross-origin requests from any origin. The limit is 60 calls an hour per reader's address, which is enough to mount a few repositories and read some dozens of files, given the cache.
- **Signed in**, calls go through the site's server, which adds the reader's token (below). The limit is 5,000 calls an hour per reader, and private repositories the reader has granted are reachable.
- raw.githubusercontent.com is not used: whether it allows cross-origin reads is not documented, and the site does not rely on undocumented behaviour.

## Sign-in

- **A GitHub App, not an OAuth App.** An OAuth App can only ask for the `repo` scope to read private repositories, which grants writing to all of them as well. A GitHub App asks for exactly "Contents: read" and "Metadata: read", and the reader chooses which repositories it may see when they install it. Its user tokens expire after eight hours and are refreshed.
- **The token never reaches the browser.** The server runs GitHub's web sign-in flow (`/auth/github/start` and `/auth/github/callback`), keeps the token in an encrypted, HTTP-only cookie (ASP.NET data protection, as the admin site's own cookies are), and proxies the reader's calls at `/api/github/…`. The proxy allows only the read calls above and `GET /user`, so it cannot be used as an open relay to GitHub.
- Any reader of the public site may sign in with their own GitHub account; it only ever reads what that account has granted, for that reader. Signing out deletes the cookie.

## What Paul needs to do

Register a GitHub App under his account, with:

- the callback URL `https://parkscomputing.com/auth/github/callback` (and the edit origin's, if the admin site signs in too);
- "Expire user authorization tokens" on;
- repository permissions "Contents: Read-only" and "Metadata: Read-only", and nothing else;
- "Request user authorization (OAuth) during installation" on, so installing it and signing in are one step.

Its client ID and a client secret go into the site's configuration as secrets, never into the repository.

## Still open

1. Whether the admin site signs in to GitHub as well, or only the public site.
2. Whether the GitHub App is the right choice over an OAuth App, given that readers must install it on their repositories before private ones show.
3. Mounting: whether a mount should also be addressable, such as `/page/files?path=/github/owner/repo`, mounting the repository on arrival.
