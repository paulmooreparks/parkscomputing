using System.ComponentModel;
using System.Text.Json.Serialization;
using System.Text.Json;

namespace SmartSam.Comments.Lib {
    public class Comment {
        [Description("Unique ID for each comment")]
        public string? CommentId { get; set; }
        public string? Domain { get; set; }
        public string? PageId { get; set; }
        public string? Title { get; set; }
        public string? Name { get; set; }
        public string? Email { get; set; }
        public string? CommentText { get; set; }
        public DateTime CreateDateTime { get; set; }
        public bool Edited { get; set; } = false;
        public bool IsFlagged { get; set; } = false;
        [JsonConverter(typeof(JsonStringEnumConverter<CommentStatus>))]
        public CommentStatus Status { get; set; }
        public string? UserId { get; set; } // Foreign key to User
        public User? User { get; set; }
    }

    public class JsonStringEnumConverter<T> : JsonConverter<T> where T : Enum {
        public override T Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) {
            string? enumString = reader.GetString();
            return (T)Enum.Parse(typeToConvert, enumString!);
        }

        public override void Write(Utf8JsonWriter writer, T value, JsonSerializerOptions options) {
            writer.WriteStringValue(value.ToString());
        }
    }
}