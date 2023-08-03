using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace SmartSam.Comments.Data {
    // In SmartSam.Comments.Data Project
    public static class DbContextConfiguration {
        public static void Configure(IServiceCollection services, string? connectionString = null) {
            if (string.IsNullOrEmpty(connectionString)) {
                services.AddDbContext<AppDbContext>(options => options.UseInMemoryDatabase("InMemoryDb"));
            }
            //else {
            //    services.AddDbContext<AppDbContext>(options => options.UseSqlServer(connectionString));
            //}
        }
    }
}
