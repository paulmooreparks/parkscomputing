namespace ParksComputing.Engine.Api {
    /// <summary>Fields a client is allowed to modify for an existing content item.</summary>
    public record UpdateContentRequest(string? Title, string? Description, string? Language, string? BodyMarkdown);
}
