# Books

Paul wants pages with subordinate pages, nested, for his project pages and some articles, written in Markdown (2026-10-01). A book is a main page with chapters under it. It is also the trial for replacing `sitenav.xfer` with `index.md` files: if a folder of Markdown with front matter can describe a book well, it can describe the whole site.

## Writing a book

A page becomes a book only when its front matter says so. The `chapters` key names the folder that holds its chapters, relative to the page's own folder, and each Markdown file in that folder is a chapter. A chapter with chapters of its own declares them the same way, to any depth. Nothing is a book because of how its files are named; Paul rejected that as coding by convention (2026-10-01).

```
content/maize.md                 chapters: maize
content/maize/version-2.md       chapters: version-2
content/maize/version-2/isa.md
content/maize/details.md
```

The folders may be called anything, and a folder no page declares is ignored. A chapter's address is built from the chapter files' names, so `/page/maize/version-2/isa` stays the same whatever the folders are called.

A chapter is an ordinary Markdown page with front matter. Its `title` names it in the contents, falling back to its first heading and then to its file name. Its `order` places it among its siblings; chapters without one follow those with one, by title. The order lives in each file rather than in a list on the main page, because a list goes stale whenever a file is added or renamed.

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

## Books from mdBook

The first real book is the Tela reference, "Tela: The Complete Reference", whose source is the mdBook in the Tela repository (`book/src`, published at telaproject.org/book). It sits under the Tela project page, so `content/tela.md` is its main page (2026-10-01). The Tela repository stays the source of truth, so the book is imported rather than copied, by `Tools/import-mdbook.mjs`, which can be run again whenever the Tela docs change:

```
node Tools/import-mdbook.mjs C:/Users/paul/source/repos/tela/book \
  C:/Users/paul/OneDrive/Documents/parkscomputing.com/wwwroot/content tela \
  C:/Users/paul/OneDrive/Documents/parkscomputing.com/wwwroot/images/books/tela \
  https://github.com/paulmooreparks/tela
```

The main page must already exist and declare its chapters' folder (`chapters: tela`); the importer refuses to run otherwise. It replaces that folder entirely and leaves `content/tela.md` alone. `SUMMARY.md` gives the structure: each part becomes a page listing its chapters, declaring a folder that holds them, and each chapter a file with its title, its place and its source's last commit date in front matter. What mdBook does and this site does not is done once, at import: `{{#include}}` pulls the named lines in, links between chapters become the chapters' addresses here, links to other files of the repository go to GitHub, a link to a file that does not exist keeps its words and loses the link, and images move to `images/books/tela/`. The Leanpub draft in `book/leanpub` is an outline of stubs and is not imported.

Headings on every Markdown page now carry ids, in the GitHub style mdBook uses, so a link to `#section` lands on its section, within a page or across chapters. A link to a chapter from anywhere in the window view, in the book's text or in another article, turns an open window of that book to it, or opens one there.

## A fix found on the way

The classic page route takes any path after `/page/` and looked its file up without checking it, so a path holding `..` could name a file outside `content/`. Only `.md` and `.html` files could be read that way, but it was wrong. Every content path is now plain names joined by slashes, or the page is not found.

## Not yet

- The terminal shows a book as its main page only. Its chapters could be a folder under the book.
- The Edit link on a chapter leads to the edit origin's source view, which knows only top-level pages.
- The list filter and the tag pages know only the main page.
