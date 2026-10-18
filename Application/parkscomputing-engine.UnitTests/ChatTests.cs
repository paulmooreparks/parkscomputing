using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using ParksComputing.Engine.Chat;
using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.UnitTests;

/// <summary>The chat's providers, as they read a stream and write a request
/// (Chat/ChatProviders.cs), and its grants (Identity/ChatGrants.cs).</summary>
[TestClass]
public class ChatTests {
    private static async Task<List<ProviderEvent>> Read(IAsyncEnumerable<ProviderEvent> events) {
        var list = new List<ProviderEvent>();
        await foreach (var e in events) { list.Add(e); }
        return list;
    }
    private static Stream Body(string text) => new MemoryStream(Encoding.UTF8.GetBytes(text));

    [TestMethod]
    public async Task AnOpenAiStreamGivesTextThinkingToolsAndUsage() {
        var sse = string.Join("\n\n", new[] {
            "data: {\"choices\":[{\"delta\":{\"reasoning\":\"Let me \"}}]}",
            "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"look.\"}}]}",
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"function\":{\"name\":\"site_file_read\",\"arguments\":\"{\\\"pa\"}}]}}]}",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"th\\\":\\\"~/x\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}",
            "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":12,\"completion_tokens\":5}}",
            "data: [DONE]", ""
        });
        var events = await Read(OpenAiProvider.Parse(Body(sse), CancellationToken.None));
        Assert.AreEqual("Let me look.", string.Concat(events.OfType<ThinkingDelta>().Select(t => t.Text)));
        Assert.AreEqual("Hello", string.Concat(events.OfType<TextDelta>().Select(t => t.Text)));
        var call = events.OfType<ToolCallReady>().Single();
        Assert.AreEqual("call_1", call.Id); Assert.AreEqual("site_file_read", call.Name);
        Assert.AreEqual("~/x", call.Input["path"]!.GetValue<string>());
        Assert.AreEqual(12, events.OfType<UsageReport>().Single().Input);
        Assert.AreEqual("tool_use", events.OfType<Finished>().Single().StopReason);
    }

    [TestMethod]
    public async Task AnOpenAiErrorInTheStreamIsSaid() {
        await Assert.ThrowsExceptionAsync<ProviderException>(() => Read(OpenAiProvider.Parse(Body("data: {\"error\":{\"message\":\"model retired\"}}\n\n"), CancellationToken.None)));
    }

    [TestMethod]
    public async Task AnAnthropicStreamGivesThinkingWithItsSignatureTextAndATool() {
        var sse = string.Join("\n\n", new[] {
            "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":30}}}",
            "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"thinking\"}}",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"Hmm.\"}}",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"signature_delta\",\"signature\":\"sig\"}}",
            "event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}",
            "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"text_delta\",\"text\":\"Reading.\"}}",
            "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":2,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_1\",\"name\":\"site_pages\",\"input\":{}}}",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":2,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{}\"}}",
            "event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":2}",
            "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"},\"usage\":{\"output_tokens\":9}}",
            "event: ping\ndata: {\"type\":\"ping\"}",
            "event: message_stop\ndata: {\"type\":\"message_stop\"}", ""
        });
        var events = await Read(AnthropicProvider.Parse(Body(sse), CancellationToken.None));
        Assert.AreEqual("Hmm.", events.OfType<ThinkingDelta>().Single().Text);
        Assert.AreEqual("sig", events.OfType<ThinkingSignature>().Single().Signature);
        Assert.AreEqual("Reading.", events.OfType<TextDelta>().Single().Text);
        Assert.AreEqual("site_pages", events.OfType<ToolCallReady>().Single().Name);
        var usage = events.OfType<UsageReport>().Single();
        Assert.AreEqual(30, usage.Input); Assert.AreEqual(9, usage.Output);
        Assert.AreEqual("tool_use", events.OfType<Finished>().Single().StopReason);
    }

    private static ProviderRequest Conversation(bool thinking) {
        var messages = new List<ChatMessage> {
            new() { Role = "user", Parts = { ChatPart.TextPart("Read it"), new ChatPart { Type = "file", Name = "a.md", Text = "# A" }, new ChatPart { Type = "image", MediaType = "image/png", Data = "AAAA" } } },
            new() { Role = "assistant", Parts = {
                new ChatPart { Type = "thinking", Text = "plan", Signature = "sig" }, ChatPart.TextPart("Reading."),
                new ChatPart { Type = "tool_use", Id = "t1", Name = "site_file_read", Input = new JsonObject { ["path"] = "~/a.md" } } } },
            new() { Role = "user", Parts = { new ChatPart { Type = "tool_result", Id = "t1", Status = "completed", Text = "# A" } } }
        };
        return new ProviderRequest("m", "Be brief.", messages, new[] { new ToolSpec("site_file_read", "Read a file", new JsonObject { ["type"] = "object" }) }, thinking);
    }

    [TestMethod]
    public void AnOpenAiRequestCarriesTheSystemAttachmentsToolCallsAndResults() {
        var body = OpenAiProvider.Body(Conversation(true), 500);
        var messages = body["messages"]!.AsArray();
        Assert.AreEqual("system", messages[0]!["role"]!.GetValue<string>());
        var user = messages[1]!["content"]!.AsArray();
        StringAssert.Contains(user[1]!["text"]!.GetValue<string>(), "Attached file a.md");
        Assert.AreEqual("data:image/png;base64,AAAA", user[2]!["image_url"]!["url"]!.GetValue<string>());
        Assert.AreEqual("site_file_read", messages[2]!["tool_calls"]![0]!["function"]!["name"]!.GetValue<string>());
        Assert.AreEqual("{\"path\":\"~/a.md\"}", messages[2]!["tool_calls"]![0]!["function"]!["arguments"]!.GetValue<string>());
        Assert.AreEqual("tool", messages[3]!["role"]!.GetValue<string>());
        Assert.AreEqual("t1", messages[3]!["tool_call_id"]!.GetValue<string>());
        Assert.AreEqual("function", body["tools"]![0]!["type"]!.GetValue<string>());
        Assert.AreEqual(500, body["max_tokens"]!.GetValue<int>());
    }

    [TestMethod]
    public void AnAnthropicRequestSendsThinkingBackOnlyWhenThinkingIsOn() {
        var on = AnthropicProvider.Body(Conversation(true), null, 2048);
        Assert.AreEqual("enabled", on["thinking"]!["type"]!.GetValue<string>());
        Assert.IsTrue(on["max_tokens"]!.GetValue<int>() > 2048);
        var assistant = on["messages"]![1]!["content"]!.AsArray();
        Assert.AreEqual("thinking", assistant[0]!["type"]!.GetValue<string>());
        Assert.AreEqual("sig", assistant[0]!["signature"]!.GetValue<string>());
        Assert.AreEqual("tool_result", on["messages"]![2]!["content"]![0]!["type"]!.GetValue<string>());
        Assert.IsFalse(on["messages"]![2]!["content"]![0]!["is_error"]!.GetValue<bool>());
        Assert.AreEqual("Be brief.", on["system"]!.GetValue<string>());

        var off = AnthropicProvider.Body(Conversation(false), null, null);
        Assert.IsNull(off["thinking"]);
        Assert.AreEqual("text", off["messages"]![1]!["content"]![0]!["type"]!.GetValue<string>());
    }

    [TestMethod]
    public void AGrantIsFoundUntilItIsRevokedOrRunsOut() {
        var clock = new ManualClock(DateTimeOffset.Parse("2026-10-18T00:00:00Z"));
        var grants = new ChatGrants(clock);
        var user = new IdentityUser("paul");
        var secret = grants.Create(user, "chat", new[] { "files.read" }, TimeSpan.FromHours(1));
        StringAssert.StartsWith(secret, ChatGrants.Prefix);
        Assert.AreEqual("files.read", grants.Find(secret)!.Capabilities.Single());
        Assert.IsNull(grants.Find(secret + "x"));
        Assert.IsNull(grants.Find("pcmcp_" + secret));
        clock.Now = clock.Now.AddHours(2);
        Assert.IsNull(grants.Find(secret), "a grant runs out");
        var again = grants.Create(user, "chat", Array.Empty<string>(), TimeSpan.FromHours(1));
        grants.Revoke(again);
        Assert.IsNull(grants.Find(again), "a revoked grant is gone");
    }

    private sealed class ManualClock : TimeProvider {
        public DateTimeOffset Now;
        public ManualClock(DateTimeOffset now) { Now = now; }
        public override DateTimeOffset GetUtcNow() => Now;
    }
}
