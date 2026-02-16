using Microsoft.AspNetCore.Hosting;
using System;
using System.Collections.Generic;
using System.IO;

namespace ParksComputing.Engine.Api {
    /// <summary>
    /// Extension to FileContentStorage for audio content detection and management
    /// </summary>
    public static class AudioContentExtensions {
        /// <summary>
        /// Check if an audio version exists for a given content ID
        /// </summary>
        public static bool HasAudioVersion(this IWebHostEnvironment env, string contentId) {
            var audioPath = Path.Combine(env.WebRootPath, "audio", "articles", contentId);

            return File.Exists($"{audioPath}.mp3") ||
                   File.Exists($"{audioPath}.ogg") ||
                   File.Exists($"{audioPath}.wav");
        }

        /// <summary>
        /// Get available audio formats for a content ID
        /// </summary>
        public static List<string> GetAudioFormats(this IWebHostEnvironment env, string contentId) {
            var formats = new List<string>();
            var audioPath = Path.Combine(env.WebRootPath, "audio", "articles", contentId);

            if (File.Exists($"{audioPath}.mp3"))
                formats.Add("mp3");

            if (File.Exists($"{audioPath}.ogg"))
                formats.Add("ogg");

            if (File.Exists($"{audioPath}.wav"))
                formats.Add("wav");

            return formats;
        }

        /// <summary>
        /// Get transcript content if available
        /// </summary>
        public static string? GetTranscript(this IWebHostEnvironment env, string contentId) {
            var transcriptPath = Path.Combine(env.WebRootPath, "audio", "articles", $"{contentId}.transcript.html");

            if (File.Exists(transcriptPath)) {
                return File.ReadAllText(transcriptPath);
            }

            return null;
        }

        /// <summary>
        /// Create directory structure for audio content
        /// </summary>
        public static void EnsureAudioDirectories(this IWebHostEnvironment env) {
            var audioDir = Path.Combine(env.WebRootPath, "audio");
            var articlesDir = Path.Combine(audioDir, "articles");

            Directory.CreateDirectory(audioDir);
            Directory.CreateDirectory(articlesDir);
        }

        /// <summary>
        /// Get audio metadata (duration, file size, etc.)
        /// </summary>
        public static AudioMetadata? GetAudioMetadata(this IWebHostEnvironment env, string contentId) {
            var audioPath = Path.Combine(env.WebRootPath, "audio", "articles", contentId);

            // Check for MP3 first (most common)
            string? filePath = null;
            string format = "";

            if (File.Exists($"{audioPath}.mp3")) {
                filePath = $"{audioPath}.mp3";
                format = "mp3";
            }
            else if (File.Exists($"{audioPath}.ogg")) {
                filePath = $"{audioPath}.ogg";
                format = "ogg";
            }
            else if (File.Exists($"{audioPath}.wav")) {
                filePath = $"{audioPath}.wav";
                format = "wav";
            }

            if (filePath != null && File.Exists(filePath)) {
                var fileInfo = new FileInfo(filePath);
                return new AudioMetadata {
                    Format = format,
                    FileSize = fileInfo.Length,
                    LastModified = fileInfo.LastWriteTime,
                    RelativePath = $"/audio/articles/{contentId}.{format}"
                };
            }

            return null;
        }

        /// <summary>
        /// Check if a video link exists for content (from front matter or meta tags)
        /// </summary>
        public static string? GetVideoLink(this IWebHostEnvironment env, Dictionary<string, object>? frontMatter, List<HtmlAgilityPack.HtmlNode>? metaElements) {
            // Check front matter first
            if (frontMatter != null && frontMatter.TryGetValue("youtubeLink", out var frontMatterVideo)) {
                return frontMatterVideo?.ToString();
            }

            if (frontMatter != null && frontMatter.TryGetValue("videoLink", out var frontMatterVideoGeneric)) {
                return frontMatterVideoGeneric?.ToString();
            }

            // Check meta elements
            if (metaElements != null) {
                foreach (var meta in metaElements) {
                    var name = meta.GetAttributeValue("name", "");
                    var content = meta.GetAttributeValue("content", "");

                    if ((name == "youtube-link" || name == "video-link") && !string.IsNullOrEmpty(content)) {
                        return content;
                    }
                }
            }

            return null;
        }

        /// <summary>
        /// Get video platform and ID from a video URL
        /// </summary>
        public static VideoInfo? ParseVideoUrl(string? videoUrl) {
            if (string.IsNullOrEmpty(videoUrl)) return null;

            // YouTube patterns
            var youtubePatterns = new[] {
                @"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/)([a-zA-Z0-9_-]{11})",
                @"youtube\.com/watch.*[&?]v=([a-zA-Z0-9_-]{11})"
            };

            foreach (var pattern in youtubePatterns) {
                var match = System.Text.RegularExpressions.Regex.Match(videoUrl, pattern, System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                if (match.Success) {
                    return new VideoInfo {
                        Platform = "YouTube",
                        VideoId = match.Groups[1].Value,
                        OriginalUrl = videoUrl,
                        EmbedUrl = $"https://www.youtube.com/embed/{match.Groups[1].Value}"
                    };
                }
            }

            // Could add more platforms here (Vimeo, etc.)
            return new VideoInfo {
                Platform = "Unknown",
                VideoId = "",
                OriginalUrl = videoUrl,
                EmbedUrl = videoUrl
            };
        }
    }

    /// <summary>
    /// Audio metadata information
    /// </summary>
    public class AudioMetadata {
        public string Format { get; set; } = "";
        public long FileSize { get; set; }
        public DateTime LastModified { get; set; }
        public string RelativePath { get; set; } = "";
        public TimeSpan? Duration { get; set; }

        public string FormattedFileSize {
            get {
                string[] sizes = { "B", "KB", "MB", "GB" };
                double len = FileSize;
                int order = 0;
                while (len >= 1024 && order < sizes.Length - 1) {
                    order++;
                    len = len / 1024;
                }
                return $"{len:0.##} {sizes[order]}";
            }
        }
    }

    /// <summary>
    /// Video information and metadata
    /// </summary>
    public class VideoInfo {
        public string Platform { get; set; } = "";
        public string VideoId { get; set; } = "";
        public string OriginalUrl { get; set; } = "";
        public string EmbedUrl { get; set; } = "";
    }
}
