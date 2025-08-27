using Microsoft.EntityFrameworkCore;

namespace ParksComputing.Engine.Auth {
    public class AuthDbContext : DbContext {
        public AuthDbContext(DbContextOptions<AuthDbContext> options) : base(options) { }
        public DbSet<UserAccount> Users => Set<UserAccount>();
        protected override void OnModelCreating(ModelBuilder modelBuilder) {
            modelBuilder.Entity<UserAccount>(b => {
                b.HasIndex(u => u.Username).IsUnique();
                b.Property(u => u.Username).IsRequired().HasMaxLength(100);
                b.Property(u => u.PasswordHash).IsRequired();
            });
        }
    }
}
