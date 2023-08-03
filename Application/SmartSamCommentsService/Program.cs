using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.EntityFrameworkCore;

using SmartSam.Comments.Data;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices(services => {
        services.AddDbContext<AppDbContext>(options => options.UseInMemoryDatabase("InMemoryDb"));
    })
    .Build();

host.Run();
