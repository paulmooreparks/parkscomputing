# Books

Paul wants pages with subordinate pages, nested, for his project pages and some articles, written in Markdown (2026-10-01). A book is a main page with chapters under it. It is also the trial for replacing `sitenav.xfer` with `index.md` files: if a folder of Markdown with front matter can describe a book well, it can describe the whole site.

## Writing a book

A book is a main page, `content/{slug}.md`, beside a folder of the same name, `content/{slug}/`. Each Markdown file in the folder is a chapter, and a chapter's own folder holds its chapters, to any depth:

```
content/maize.md
content/maize/version-2.md
content/maize/version-2/isa.md
content/maize/details.md
```

A chapter is an ordinary Markdown page with front matter. Its `title` names it in the contents, falling back to its first heading and then to its file name. Its `order` places it among its siblings; chapters without one follow those with one, by title. The order lives in each file rather than in a list on the main page, because a list goes stale whenever a file is added or renamed. A folder with chapters but no file of its own shows in the contents as a heading that is not a link.

The book's main page is listed in `sitenav.xfer` like any page. Its chapters are not; they belong to the book.

## Reading a book

Every chapter is a page with its own address, `/page/{slug}/{path}`, such as `/page/maize/version-2/isa`, so it can be linked, bookmarked and shared.

- **The contents** sit beside the page, as PUDL's tree inside a disclosure. Branches open and close, the current chapter is marked, and the branch holding it starts open. The whole contents fold away with their heading. Without script the tree shows fully open and every link works.
- **Previous and next** chapters, in reading order (the main page, then each chapter before its own chapters), follow the page.
- **Where the book has less room than a sidebar and a readable page together,** a phone or a narrow window, the contents go above the page. This is a container query on the book, so a window behaves as a screen of its size does. On a classic page on a phone, the contents start folded.

## In the window view

A book is one window that turns its pages. A click on a chapter, in the contents or on Previous and Next, fetches that chapter into the same window (`/window/{key}?c={path}`), and the address records it as `c.{key}`. Back returns to the chapter before, a reload or a bookmark brings the window back at its chapter, and a link such as `/?open=maize&c.maize=version-2/isa` opens the book there. The window's page button follows its chapter. The remembered window arrangement keeps the chapters too.

Shift+click on a chapter opens it in another window of the same book, `maize-2` up to `maize-9`, as Shift+click opens a new browser window; the window menu's "Open in a new window" does the same at the current chapter. Ctrl+click and a middle click go to the chapter's own page. Closing a window takes its chapter out of the address.

The code is `Pages/Services/BookService.cs` (the chapter tree and the markup), `ArticleContentService.LoadBook` (a book's window), `wwwroot/js/books.js` (turning pages in a window) and the book rules in `wwwroot/css/pudl-site.css`.

## A fix found on the way

The classic page route takes any path after `/page/` and looked its file up without checking it, so a path holding `..` could name a file outside `content/`. Only `.md` and `.html` files could be read that way, but it was wrong. Every content path is now plain names joined by slashes, or the page is not found.

## Not yet

- The terminal shows a book as its main page only. Its chapters could be a folder under the book.
- The Edit link on a chapter leads to the edit origin's source view, which knows only top-level pages.
- The list filter and the tag pages know only the main page.
