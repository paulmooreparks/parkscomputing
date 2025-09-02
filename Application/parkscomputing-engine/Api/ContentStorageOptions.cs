namespace ParksComputing.Engine.Api {
    // Options to control which file extensions are treated as content and draft folder naming.
    public class ContentStorageOptions {
        // File extensions (with leading dot) that should be indexed as content. Default: .md, .html
        public string[] Extensions { get; set; } = new[] { ".md", ".html" };
        // Folder name that marks content as drafts (case-insensitive match on relative path segments)
        public string DraftsFolderName { get; set; } = "drafts";
    }
}
