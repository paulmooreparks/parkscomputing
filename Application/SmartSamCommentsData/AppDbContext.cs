using Microsoft.EntityFrameworkCore;

using SmartSam.Comments.Lib;

namespace SmartSam.Comments.Data {
    public class AppDbContext : DbContext {
        public DbSet<User> Users { get; set; }
        public DbSet<Comment> Comments { get; set; }

        public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) {
        }

        protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder) {
            optionsBuilder.UseInMemoryDatabase("InMemoryDb");
        }

        protected override void OnModelCreating(ModelBuilder modelBuilder) {
            // Configure the User entity
            modelBuilder.Entity<User>()
                .HasKey(u => new { u.UserId, u.Domain }); // Composite key using UserId and Domain
            modelBuilder.Entity<User>()
                .HasIndex(u => u.Domain); // Index on Domain for partitioning

            // Configure the Comment entity
            modelBuilder.Entity<Comment>()
                .HasKey(c => c.CommentId); // Primary key for Comment
            modelBuilder.Entity<Comment>()
                .HasIndex(c => c.Domain); // Index on Domain for partitioning
            modelBuilder.Entity<Comment>()
                .HasOne(c => c.User) // Relationship with User
                .WithMany(u => u.Comments) // One User can have many Comments
                .HasForeignKey(c => new { c.UserId, c.Domain }) // Foreign key linking to composite key in User
                .OnDelete(DeleteBehavior.Cascade); // Cascade delete if User is deleted

            // Additional configuration
        }
    }
}