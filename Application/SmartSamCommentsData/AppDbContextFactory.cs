using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

using SmartSam.Comments.Data;

public class AppDbContextFactory : IDesignTimeDbContextFactory<AppDbContext> {
    public AppDbContext CreateDbContext(string[] args) {
        var optionsBuilder = new DbContextOptionsBuilder<AppDbContext>();
        optionsBuilder.UseSqlServer("Server=localhost;Database=SmartSamComments;Trusted_Connection=True;Encrypt=False;");

        return new AppDbContext(optionsBuilder.Options);
    }
}
