using System;
using System.ComponentModel.DataAnnotations;

namespace ParksComputing.Engine.Auth {
    public class UserAccount {
        public int Id { get; set; }
        [Required]
        public string Username { get; set; } = string.Empty;
        [Required]
        public string PasswordHash { get; set; } = string.Empty;
        public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
        public bool IsActive { get; set; } = true;
    }
}
