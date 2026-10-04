"""Read-only content inventory for the unified identity migration.

This detects review candidates. It does not sanitize content, approve trust,
assign article identities, or change the publishing tree.
"""

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path


class MarkupFacts(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.signals = set()
        self.dependencies = set()
        self.metadata = {}

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag in {"script", "iframe", "object", "embed", "svg", "style", "base", "form"}:
            self.signals.add(tag)
        if tag == "meta":
            name = (values.get("name") or "").lower()
            if name in {"comments-enabled", "comments-allowed"} and name not in self.metadata:
                self.metadata[name] = (values.get("content") or "").lower() == "true"
            if (values.get("http-equiv") or "").lower() == "refresh":
                self.signals.add("meta-refresh")
        for name, value in attrs:
            if name.startswith("on") or name == "srcdoc":
                self.signals.add("active-attribute")
            if value and re.match(r"\s*(javascript|vbscript|data)\s*:", value, re.I):
                self.signals.add("active-url-candidate")
        if tag == "script" and values.get("src"):
            self.dependencies.add(values["src"])
        if tag == "link" and "stylesheet" in (values.get("rel") or "").lower().split():
            self.signals.add("stylesheet")
            if values.get("href"):
                self.dependencies.add(values["href"])

    handle_startendtag = handle_starttag


def inspect_content(relative_path, data):
    text = data.decode("utf-8-sig")
    metadata = {}
    body = text
    markdown = relative_path.lower().endswith(".md")
    # Match the current renderer's top-level scalar front matter. Nested menu
    # entries must not change the article's comment setting.
    if markdown and text.startswith("---"):
        end = text.find("\n---", 3)
        if end >= 0:
            body = text[end + 4:]
            for line in text[3:end].splitlines():
                if not line or line[0].isspace() or line.startswith("#") or ":" not in line:
                    continue
                key, value = line.split(":", 1)
                key = key.strip().lower()
                value = value.strip().strip('"').lower()
                if key in {"commentsenabled", "commentsallowed"} and value in {"true", "false"}:
                    metadata[key] = value == "true"
    facts = MarkupFacts()
    facts.feed(body)
    # HTML meta tags in Markdown are also consumed by the current page renderer.
    # Flag disagreements for human review instead of guessing import intent.
    if markdown:
        enabled = metadata.get("commentsenabled", False)
        allowed = metadata.get("commentsallowed", False)
    else:
        enabled = facts.metadata.get("comments-enabled", False)
        allowed = facts.metadata.get("comments-allowed", False)
    return {
        "path": relative_path,
        "legacy_slug": str(Path(relative_path).with_suffix("")).replace("\\", "/"),
        "sha256": hashlib.sha256(data).hexdigest(),
        "bytes": len(data),
        "comment_policy_candidate": "Disabled" if not enabled else "Open" if allowed else "Closed",
        "markdown_comment_metadata": metadata,
        "html_comment_metadata": facts.metadata,
        "review_signals": sorted(facts.signals),
        "declared_code_and_style_dependencies": sorted(facts.dependencies),
        "draft_path_candidate": "drafts" in Path(relative_path).parts,
        "trust": "Unreviewed",
    }


def inventory(root):
    root = Path(root).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("The content root must be a directory")
    articles, skipped, errors = [], [], []

    def walk(directory):
        for path in sorted(directory.iterdir()):
            relative = path.relative_to(root).as_posix()
            if path.is_symlink() or path.is_junction():
                skipped.append({"path": relative, "reason": "linked path"})
            elif path.name in {".git", ".vs", "node_modules", "bin", "obj"}:
                skipped.append({"path": relative, "reason": "build or tool directory"})
            elif path.is_dir():
                walk(path)
            elif path.suffix.lower() in {".md", ".html", ".htm"}:
                try:
                    articles.append(inspect_content(relative, path.read_bytes()))
                except (UnicodeError, OSError, ValueError) as error:
                    errors.append({"path": relative, "error": type(error).__name__})

    walk(root)
    slugs = {}
    for article in articles:
        slugs.setdefault(article["legacy_slug"].casefold(), []).append(article["path"])
    return {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "content_root": str(root),
        "read_only": True,
        "scope": "Content files only; shell assets, dynamic imports and external code need separate review",
        "articles": articles,
        "slug_collisions": [paths for paths in slugs.values() if len(paths) > 1],
        "skipped": skipped,
        "errors": errors,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("content_root", type=Path)
    args = parser.parse_args()
    report = inventory(args.content_root)
    print(json.dumps(report, indent=2, ensure_ascii=True))
    return 1 if report["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
