using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;

namespace ParksComputing.Engine.Api {
    public class TokenService {
        private readonly IConfiguration _config;
        private readonly byte[] _keyBytes;
        public TokenService(IConfiguration config) {
            _config = config;
            var secret = _config.GetSection("Jwt").GetValue<string>("Secret")
                         ?? Environment.GetEnvironmentVariable("JWT_SECRET");

            if (string.IsNullOrWhiteSpace(secret)) {
                throw new InvalidOperationException("JWT secret missing. Set Jwt:Secret or JWT_SECRET environment variable (32+ bytes).");
            }

            _keyBytes = Encoding.UTF8.GetBytes(secret);

            if (_keyBytes.Length < 32) {
                throw new InvalidOperationException($"JWT secret is too short: {_keyBytes.Length} bytes. Minimum is 32 bytes (256 bits) for HS256. Configure Jwt:Secret (or JWT_SECRET env var) with a longer value.");
            }
        }

        public string IssueToken(string subject, IEnumerable<Claim>? extra = null, TimeSpan? lifetime = null) {
            var creds = new SigningCredentials(new SymmetricSecurityKey(_keyBytes), SecurityAlgorithms.HmacSha256);
            var claims = new List<Claim> {
                new Claim(JwtRegisteredClaimNames.Sub, subject)
            };

            if (extra != null) {
                claims.AddRange(extra);
            }

            var now = DateTime.UtcNow;
            var jwt = new JwtSecurityToken(
                claims: claims,
                notBefore: now,
                expires: now.Add(lifetime ?? TimeSpan.FromHours(8)),
                signingCredentials: creds);

            return new JwtSecurityTokenHandler().WriteToken(jwt);
        }
    }
}
