using System;
using System.Threading.Tasks;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace ParksComputing.Engine.Auth {
    public class CredentialService : ICredentialService {
        private readonly AuthDbContext _db;
        private readonly ILogger<CredentialService> _logger;
        public CredentialService(AuthDbContext db, ILogger<CredentialService> logger) { _db = db; _logger = logger; }

        public async Task<bool> ValidateAsync(string username, string password) {
            if (string.IsNullOrWhiteSpace(username) || string.IsNullOrEmpty(password)) { return false; }
            var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Username == username && u.IsActive);
            if (user == null) { return false; }
            try {
                return BCrypt.Net.BCrypt.Verify(password, user.PasswordHash);
            } catch (Exception ex) {
                _logger.LogWarning(ex, "Password verification failed for user {User}", username);
                return false;
            }
        }

        public static async Task SeedIfEmptyAsync(AuthDbContext db, string? seedUsername, string? seedPasswordHash, ILogger logger) {
            if (await db.Users.AnyAsync()) { return; } // already seeded
            if (string.IsNullOrWhiteSpace(seedUsername) || string.IsNullOrWhiteSpace(seedPasswordHash)) {
                logger.LogWarning("Auth DB empty and no seed credentials provided; no users created.");
                return;
            }
            // Basic bcrypt format check: $2a$|$2b$|$2y$ + cost + 53 chars (total length 60)
            if (!Regex.IsMatch(seedPasswordHash, @"^\$2[aby]\$\d\d\$.{53}$")) {
                logger.LogWarning("Provided seed password hash appears invalid (length {Len}). Did you lose leading '$' segments? Expected bcrypt format like $2a$12$... (60 chars).", seedPasswordHash.Length);
                return;
            }
            db.Users.Add(new UserAccount { Username = seedUsername, PasswordHash = seedPasswordHash, CreatedUtc = DateTime.UtcNow, IsActive = true });
            await db.SaveChangesAsync();
            logger.LogInformation("Seeded initial admin user '{User}'.", seedUsername);
        }
    }
}
