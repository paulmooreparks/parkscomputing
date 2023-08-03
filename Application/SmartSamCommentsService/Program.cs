using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.EntityFrameworkCore;

using SmartSam.Comments.Data;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices(services => {
        DbContextConfiguration.Configure(services); // For InMemory Database
        // OR
        // DbContextConfiguration.Configure(services, "YourConnectionString"); // For SQL Server
    }).Build();

host.Run();
