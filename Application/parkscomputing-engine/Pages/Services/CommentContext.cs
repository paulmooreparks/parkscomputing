using Microsoft.EntityFrameworkCore;
using SmartSam.Comments.Lib;

namespace ParksComputing.Engine.Pages.Services {
    public class CommentContext : DbContext {
        public CommentContext(DbContextOptions<CommentContext> options) : base(options) {
        }

        public DbSet<Comment> Comments { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder) {
            modelBuilder.Entity<Comment>()
                .Property(b => b.CreateDateTime).ValueGeneratedOnAdd();
        }
    }
}
