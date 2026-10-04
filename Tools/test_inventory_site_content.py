import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("inventory", Path(__file__).with_name("inventory-site-content.py"))
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)


class InventoryTests(unittest.TestCase):
    def test_missing_metadata_keeps_comments_disabled(self):
        result = inventory.inspect_content("article.md", b"# Hello")
        self.assertEqual("Disabled", result["comment_policy_candidate"])
        self.assertEqual("Unreviewed", result["trust"])

    def test_nested_metadata_cannot_enable_comments(self):
        result = inventory.inspect_content("article.md", b'---\ncommentsEnabled: true\nmenu:\n  commentsAllowed: true\n---\nText')
        self.assertEqual("Closed", result["comment_policy_candidate"])

    def test_existing_markdown_and_html_metadata(self):
        for path, data in [
            ("article.md", b'---\ncommentsEnabled: "true"\ncommentsAllowed: true\n---\nText'),
            ("article.html", b'<meta content="true" name="comments-enabled"><meta name="comments-allowed" content="true">'),
        ]:
            with self.subTest(path=path):
                self.assertEqual("Open", inventory.inspect_content(path, data)["comment_policy_candidate"])

    def test_active_content_is_flagged_but_never_trusted(self):
        result = inventory.inspect_content("tool.html", b'<script src="/js/tool.js"></script><p onclick="run()">Hi</p>')
        self.assertIn("script", result["review_signals"])
        self.assertIn("active-attribute", result["review_signals"])
        self.assertEqual(["/js/tool.js"], result["declared_code_and_style_dependencies"])
        self.assertEqual("Unreviewed", result["trust"])

    def test_incomplete_html_attributes_do_not_abort_inventory(self):
        result = inventory.inspect_content("article.html", b'<meta name><meta name="comments-enabled" content><meta http-equiv><link rel>')
        self.assertEqual("Disabled", result["comment_policy_candidate"])

    def test_collisions_and_invalid_encoding_are_reported_without_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            originals = {"same.md": b"# Markdown", "same.html": b"<h1>HTML</h1>", "broken.md": b"\xff"}
            for name, data in originals.items():
                (root / name).write_bytes(data)
            report = inventory.inventory(root)
            self.assertEqual([["same.html", "same.md"]], report["slug_collisions"])
            self.assertEqual("broken.md", report["errors"][0]["path"])
            self.assertEqual(originals, {p.name: p.read_bytes() for p in root.iterdir()})


if __name__ == "__main__":
    unittest.main()
