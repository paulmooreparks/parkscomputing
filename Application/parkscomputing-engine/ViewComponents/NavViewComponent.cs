using System.Threading.Tasks;

using ParksComputing.Engine.Pages.Services;

using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Hosting;

namespace ParksComputing.Engine.ViewComponents {
    public class NavViewComponent : ViewComponent {
        private IHostEnvironment? Environment { get; set; }
        private INavService _navService;

        public NavViewComponent(INavService navService) {
            _navService = navService;
        }

        public IViewComponentResult Invoke() {
            return View(_navService.GetNavRoot());
        }
    }
}
