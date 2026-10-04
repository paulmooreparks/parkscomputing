using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.UnitTests;

[TestClass]
public class ResendMailerTests {
    private const string Secret = "private-email-link-token";
    private sealed class CapturedLog : ILogger<ResendMailer> {
        public readonly List<string> Messages = new();
        public IDisposable BeginScope<TState>(TState state) => null;
        public bool IsEnabled(LogLevel level) => true;
        public void Log<TState>(LogLevel level, EventId id, TState state, Exception exception, Func<TState, Exception, string> formatter) =>
            Messages.Add(formatter(state, exception) + exception);
    }
    private sealed class FakeMail : HttpMessageHandler, IHttpClientFactory {
        public bool Throw;
        public HttpClient CreateClient(string name) => new(this, disposeHandler: false);
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) =>
            Throw ? throw new HttpRequestException(Secret) : Task.FromResult(new HttpResponseMessage(HttpStatusCode.BadRequest) {
                Content = new StringContent(Secret)
            });
    }

    [DataTestMethod]
    [DataRow(false, false)]
    [DataRow(true, false)]
    [DataRow(true, true)]
    public async Task UndeliveredMailNeverLogsItsBodyOrProviderEcho(bool configured, bool throws) {
        var log = new CapturedLog();
        using var factory = new FakeMail { Throw = throws };
        var mailer = new ResendMailer(factory, Options.Create(new EmailOptions {
            ApiKey = configured ? "dummy-api-key" : null, From = configured ? "site@example.test" : null
        }), log);
        Assert.IsFalse(await mailer.SendAsync("member@example.test", Secret, Secret));
        Assert.IsTrue(log.Messages.Count > 0);
        Assert.IsFalse(string.Join("\n", log.Messages).Contains(Secret));
    }
}
