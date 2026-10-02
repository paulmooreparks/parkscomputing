using System;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using ParksComputing.Engine.Controllers;

void Check(bool value, string message) { if (!value) throw new Exception(message); }
Check(BarcodeProductsController.Eligible("3017620422003"), "Valid EAN-13");
Check(BarcodeProductsController.Eligible("036000291452"), "Valid UPC-A");
Check(BarcodeProductsController.Eligible("96385074"), "Valid EAN-8");
Check(!BarcodeProductsController.Eligible("2104213003495"), "RCN rejected");
Check(!BarcodeProductsController.Eligible("3017620422004"), "Bad checksum rejected");
var handler = new Fixture();
var controller = new BarcodeProductsController(new Factory(handler));
controller.ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() };
Check(await controller.Get("https://example.com", default) is BadRequestObjectResult, "Only identifiers allowed");
Check(handler.Calls == 0, "Invalid input never reaches provider");
var result = await controller.Get("3017620422003", default);
Check(result is OkObjectResult && System.Text.Json.JsonSerializer.Serialize(((OkObjectResult)result).Value).Contains("Tea"), "Product response");
Check(handler.Last!.RequestUri!.Host == "world.openfoodfacts.org", "Fixed host");
Check(handler.Last.Headers.UserAgent.ToString().Contains("ParksComputingBarcodeScanner"), "App identification");
Check(controller.Response.Headers.CacheControl == "no-store", "No stored result");
handler.Status = HttpStatusCode.NotFound;
result = await controller.Get("3017620422003", default);
Check(result is OkObjectResult && System.Text.Json.JsonSerializer.Serialize(((OkObjectResult)result).Value).Contains("false"), "Missing product");
handler.Status = HttpStatusCode.Found;
Check((await controller.Get("3017620422003", default) as ObjectResult)?.StatusCode == 502, "Redirect rejected");
handler.Status = HttpStatusCode.OK; handler.Body = "invalid json";
Check((await controller.Get("3017620422003", default) as ObjectResult)?.StatusCode == 502, "Invalid response");
handler.Body = new string('x', 2 * 1024 * 1024 + 1);
Check((await controller.Get("3017620422003", default) as ObjectResult)?.StatusCode == 502, "Oversized response");
handler.Body = "{\"product\":{\"product_name\":\"Tea\"}}";
while (handler.Calls < 15) await controller.Get("3017620422003", default);
Check((await controller.Get("3017620422003", default) as ObjectResult)?.StatusCode == 429, "Shared provider rate limit");
Check(handler.Calls == 15, "Rate limit prevents outbound request");
Console.WriteLine("PASS connector validation, identification, response handling, size bound and rate limit");

class Factory(Fixture handler) : IHttpClientFactory {
    public HttpClient CreateClient(string name) => new HttpClient(handler, false);
}
class Fixture : HttpMessageHandler {
    public int Calls; public HttpRequestMessage? Last;
    public HttpStatusCode Status = HttpStatusCode.OK;
    public string Body = "{\"product\":{\"product_name\":\"Tea\"}}";
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) {
        Calls++; Last = request;
        return Task.FromResult(new HttpResponseMessage(Status) { Content = new StringContent(Body, System.Text.Encoding.UTF8, "application/json") });
    }
}
