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
    public async Task AChatAsksClaudeToCacheAndCountsWhatCameFromTheCache() {
        var messages = new List<ChatMessage> { new() { Role = "user", Parts = { ChatPart.TextPart("Hello") } } };
        Assert.AreEqual("ephemeral", AnthropicProvider.Body(new ProviderRequest("m", null, messages, Array.Empty<ToolSpec>(), false, null, Cache: true), null, null)["cache_control"]?["type"]?.GetValue<string>());
        Assert.IsNull(AnthropicProvider.Body(new ProviderRequest("m", null, messages, Array.Empty<ToolSpec>(), false), null, null)["cache_control"], "only when asked");
        var sse = string.Join("\n\n", new[] {
            "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":20,\"cache_creation_input_tokens\":100,\"cache_read_input_tokens\":3000}}}",
            "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":7}}"
        }) + "\n\n";
        var usage = (await Read(AnthropicProvider.Parse(Body(sse), default))).OfType<UsageReport>().Single();
        Assert.AreEqual(3120, usage.Input, "every input token, cached or not");
        Assert.AreEqual(3000, usage.CachedInput);
        Assert.AreEqual(7, usage.Output);
    }

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

    [TestMethod]
    public async Task AnAnthropicStreamCarriesItsOwnWebSearchAndCitations() {
        var sse = string.Join("\n\n", new[] {
            "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":10}}}",
            "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"server_tool_use\",\"id\":\"srvtoolu_1\",\"name\":\"web_search\"}}",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"query\\\":\\\"ollama library\\\"}\"}}",
            "event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}",
            "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"web_search_tool_result\",\"tool_use_id\":\"srvtoolu_1\",\"content\":[{\"type\":\"web_search_result\",\"url\":\"https://ollama.com/library\",\"title\":\"Library\",\"encrypted_content\":\"abc\"}]}}",
            "event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":1}",
            "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":2,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":2,\"delta\":{\"type\":\"text_delta\",\"text\":\"It lists many.\"}}",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":2,\"delta\":{\"type\":\"citations_delta\",\"citation\":{\"type\":\"web_search_result_location\",\"url\":\"https://ollama.com/library\",\"title\":\"Library\",\"encrypted_index\":\"idx\",\"cited_text\":\"many\"}}}",
            "event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":2}",
            "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":5}}", ""
        });
        var events = await Read(AnthropicProvider.Parse(Body(sse), CancellationToken.None));
        var blocks = events.OfType<ServerBlock>().ToList();
        Assert.AreEqual(2, blocks.Count);
        Assert.AreEqual("server_tool_use", blocks[0].Block["type"]!.GetValue<string>());
        Assert.AreEqual("ollama library", blocks[0].Block["input"]!["query"]!.GetValue<string>());
        Assert.AreEqual("web_search_tool_result", blocks[1].Block["type"]!.GetValue<string>());
        Assert.AreEqual("abc", blocks[1].Block["content"]![0]!["encrypted_content"]!.GetValue<string>());
        Assert.AreEqual(1, events.OfType<BlockStart>().Count());
        Assert.AreEqual("idx", events.OfType<Citation>().Single().Value["encrypted_index"]!.GetValue<string>());
        Assert.IsFalse(events.OfType<ToolCallReady>().Any(), "the API's own search is not a tool call for the chat to run");

        /* The call row the page shows, and the result's listing. */
        var call = ChatTurns.ServerBlockEvent(blocks[0].Block)!;
        Assert.AreEqual("tool_call", call["type"]!.GetValue<string>());
        StringAssert.Contains(call["title"]!.GetValue<string>(), "ollama library");
        var result = ChatTurns.ServerBlockEvent(blocks[1].Block)!;
        Assert.AreEqual("completed", result["status"]!.GetValue<string>());
        StringAssert.Contains(result["output"]!.GetValue<string>(), "https://ollama.com/library");
    }

    [TestMethod]
    public void AnAnthropicRequestAsksForWebSearchAndSendsItsBlocksBack() {
        var messages = new List<ChatMessage> {
            new() { Role = "user", Parts = { ChatPart.TextPart("What does Ollama's library list?") } },
            new() { Role = "assistant", Parts = {
                new ChatPart { Type = "server_block", Raw = new JsonObject { ["type"] = "server_tool_use", ["id"] = "srvtoolu_1", ["name"] = "web_search", ["input"] = new JsonObject { ["query"] = "ollama library" } } },
                new ChatPart { Type = "server_block", Raw = new JsonObject { ["type"] = "web_search_tool_result", ["tool_use_id"] = "srvtoolu_1", ["content"] = new JsonArray(new JsonObject { ["type"] = "web_search_result", ["url"] = "https://ollama.com/library", ["encrypted_content"] = "abc" }) } },
                new ChatPart { Type = "text", Text = "Many.", Citations = new JsonArray(new JsonObject { ["type"] = "web_search_result_location", ["encrypted_index"] = "idx" }) } } },
            new() { Role = "user", Parts = { ChatPart.TextPart("Such as?") } }
        };
        var body = AnthropicProvider.Body(new ProviderRequest("m", null, messages, Array.Empty<ToolSpec>(), false), null, null, null, 5);
        var tool = body["tools"]![0]!;
        Assert.AreEqual("web_search_20250305", tool["type"]!.GetValue<string>());
        Assert.AreEqual(5, tool["max_uses"]!.GetValue<int>());
        var assistant = body["messages"]![1]!["content"]!.AsArray();
        Assert.AreEqual("server_tool_use", assistant[0]!["type"]!.GetValue<string>());
        Assert.AreEqual("abc", assistant[1]!["content"]![0]!["encrypted_content"]!.GetValue<string>());
        Assert.AreEqual("idx", assistant[2]!["citations"]![0]!["encrypted_index"]!.GetValue<string>());
        Assert.IsNull(AnthropicProvider.Body(new ProviderRequest("m", null, messages, Array.Empty<ToolSpec>(), false), null, null)["tools"], "no search, no tools");
    }

    [TestMethod]
    public void TheChatsOwnSearchReadsBraveAndSearxngAnswers() {
        var brave = JsonNode.Parse("{\"web\":{\"results\":[{\"title\":\"Library\",\"url\":\"https://ollama.com/library\",\"description\":\"Models.\"},{\"title\":\"No address\",\"url\":\"\"}]}}");
        var found = ChatSearch.Results("brave", brave);
        Assert.AreEqual(1, found.Count);
        Assert.AreEqual("Models.", found[0].Snippet);
        var searx = JsonNode.Parse("{\"results\":[{\"title\":\"Library\",\"url\":\"https://ollama.com/library\",\"content\":\"Models.\"}]}");
        Assert.AreEqual("Models.", ChatSearch.Results("searxng", searx)[0].Snippet);
        var text = ChatSearch.Format("ollama library", found);
        StringAssert.Contains(text, "1. Library");
        StringAssert.Contains(text, "https://ollama.com/library");
        Assert.AreEqual("Nothing found for \"x\".", ChatSearch.Format("x", Array.Empty<ChatSearch.Found>()));
        var address = ChatSearch.Address(new ChatSearchConfig { Kind = "brave" }, "a b", 7);
        Assert.AreEqual("https://api.search.brave.com/res/v1/web/search?q=a%20b&count=7", address.AbsoluteUri);
        Assert.AreEqual("https://searx.example/search?q=a%20b&format=json", ChatSearch.Address(new ChatSearchConfig { Kind = "searxng", BaseUrl = "https://searx.example/" }, "a b", 7).AbsoluteUri);
    }

    [TestMethod]
    public async Task CodexsNotificationsBecomeTheChatsEvents() {
        var events = System.Threading.Channels.Channel.CreateUnbounded<ProviderEvent>();
        var turn = new CodexProvider.TurnState(events.Writer);
        JsonObject P(string json) => (JsonObject)JsonNode.Parse(json)!;
        await CodexProvider.Translate(turn, new CodexMessage("turn/started", P("{\"threadId\":\"t1\",\"turn\":{\"id\":\"u1\"}}"), null));
        Assert.AreEqual("u1", turn.TurnId);
        await CodexProvider.Translate(turn, new CodexMessage("item/reasoning/summaryTextDelta", P("{\"threadId\":\"t1\",\"itemId\":\"r1\",\"delta\":\"Think.\"}"), null));
        await CodexProvider.Translate(turn, new CodexMessage("item/started", P("{\"threadId\":\"t1\",\"item\":{\"id\":\"c1\",\"type\":\"commandExecution\",\"command\":\"ls ~\",\"status\":\"inProgress\"}}"), null));
        /* The approval, answered by the chat's question. */
        var approval = CodexProvider.Translate(turn, new CodexMessage("item/commandExecution/requestApproval", P("{\"threadId\":\"t1\",\"itemId\":\"c1\",\"command\":\"ls ~\",\"reason\":\"to list it\"}"), JsonValue.Create(7)));
        Assert.IsTrue(events.Reader.TryRead(out var thought) && thought is ThinkingDelta { Text: "Think." });
        Assert.IsTrue(events.Reader.TryRead(out var started) && started is AgentTool { Title: "ls ~", Kind: "execute", Status: "in_progress" });
        Assert.IsTrue(events.Reader.TryRead(out var asked) && asked is AgentApproval);
        var ask = (AgentApproval)asked!;
        StringAssert.Contains(ask.Title, "ls ~"); StringAssert.Contains(ask.Title, "to list it");
        CollectionAssert.AreEqual(new[] { "accept", "decline", "cancel" }, ask.Options.Select(o => o.Id).ToList());
        ask.Answer.SetResult("accept");
        Assert.AreEqual("accept", (await approval)!["decision"]!.GetValue<string>());
        await CodexProvider.Translate(turn, new CodexMessage("item/completed", P("{\"threadId\":\"t1\",\"item\":{\"id\":\"c1\",\"type\":\"commandExecution\",\"command\":\"ls ~\",\"status\":\"completed\",\"aggregatedOutput\":\"a.md\"}}"), null));
        await CodexProvider.Translate(turn, new CodexMessage("item/agentMessage/delta", P("{\"threadId\":\"t1\",\"itemId\":\"m1\",\"delta\":\"One file.\"}"), null));
        await CodexProvider.Translate(turn, new CodexMessage("item/completed", P("{\"threadId\":\"t1\",\"item\":{\"id\":\"m1\",\"type\":\"agentMessage\",\"text\":\"One file.\"}}"), null));
        await CodexProvider.Translate(turn, new CodexMessage("thread/tokenUsage/updated", P("{\"threadId\":\"t1\",\"tokenUsage\":{\"last\":{\"inputTokens\":12,\"outputTokens\":3,\"totalTokens\":15}}}"), null));
        await CodexProvider.Translate(turn, new CodexMessage("turn/completed", P("{\"threadId\":\"t1\",\"turn\":{\"id\":\"u1\",\"status\":\"completed\"}}"), null));
        Assert.IsTrue(events.Reader.TryRead(out var done) && done is AgentTool { Status: "completed", Output: "a.md" });
        Assert.IsTrue(events.Reader.TryRead(out var text) && text is TextDelta { Text: "One file." });
        Assert.IsFalse(events.Reader.TryPeek(out var again) && again is TextDelta, "a message that streamed is not given again when it completes");
        Assert.IsTrue(events.Reader.TryRead(out var usage) && usage is UsageReport { Input: 12, Output: 3 });
        Assert.IsTrue(events.Reader.TryRead(out var fin) && fin is Finished { StopReason: "end_turn" });
        Assert.IsNull(turn.Error);
        Assert.AreEqual("turn", (await CodexProvider.Translate(turn, new CodexMessage("item/permissions/requestApproval", P("{\"threadId\":\"t1\"}"), JsonValue.Create(8))))!["scope"]!.GetValue<string>());
    }

    [TestMethod]
    public async Task ClaudesUpdatesAndPermissionsBecomeTheChatsEvents() {
        var events = System.Threading.Channels.Channel.CreateUnbounded<ProviderEvent>();
        var turn = new ClaudeProvider.TurnState(events.Writer);
        AcpMessage U(string update) => new("session/update", (JsonObject)JsonNode.Parse("{\"sessionId\":\"s1\",\"update\":" + update + "}")!, null);
        await ClaudeProvider.Translate(turn, U("{\"sessionUpdate\":\"agent_thought_chunk\",\"content\":{\"type\":\"text\",\"text\":\"Think.\"}}"));
        await ClaudeProvider.Translate(turn, U("{\"sessionUpdate\":\"tool_call\",\"toolCallId\":\"c1\",\"title\":\"`ls ~`\",\"kind\":\"execute\",\"status\":\"pending\",\"rawInput\":{\"command\":\"ls ~\"}}"));
        /* The permission, answered by the chat's question with one of Claude's own options. */
        var asked = ClaudeProvider.Translate(turn, new AcpMessage("session/request_permission", (JsonObject)JsonNode.Parse(
            "{\"sessionId\":\"s1\",\"toolCall\":{\"toolCallId\":\"c1\",\"title\":\"`ls ~`\",\"rawInput\":{\"command\":\"ls ~\"}}," +
            "\"options\":[{\"optionId\":\"allow\",\"name\":\"Allow\",\"kind\":\"allow_once\"},{\"optionId\":\"reject\",\"name\":\"Reject\",\"kind\":\"reject_once\"}]}")!, JsonValue.Create(9)));
        Assert.IsTrue(events.Reader.TryRead(out var thought) && thought is ThinkingDelta { Text: "Think." });
        Assert.IsTrue(events.Reader.TryRead(out var started) && started is AgentTool { Id: "c1", Title: "`ls ~`", Kind: "execute", Status: "in_progress" });
        Assert.IsTrue(events.Reader.TryRead(out var permission) && permission is AgentApproval);
        var ask = (AgentApproval)permission!;
        CollectionAssert.AreEqual(new[] { "allow", "reject" }, ask.Options.Select(o => o.Id).ToList());
        ask.Answer.SetResult("allow");
        var outcome = (await asked)!["outcome"]!;
        Assert.AreEqual("selected", outcome["outcome"]!.GetValue<string>());
        Assert.AreEqual("allow", outcome["optionId"]!.GetValue<string>());
        /* An update that changes nothing but the status keeps the first title. */
        await ClaudeProvider.Translate(turn, U("{\"sessionUpdate\":\"tool_call_update\",\"toolCallId\":\"c1\",\"status\":\"in_progress\"}"));
        Assert.IsFalse(events.Reader.TryRead(out _), "nothing new to say");
        /* A better title says the row again, still in progress. */
        await ClaudeProvider.Translate(turn, U("{\"sessionUpdate\":\"tool_call\",\"toolCallId\":\"t9\",\"title\":\"Terminal\",\"kind\":\"execute\",\"status\":\"pending\"}"));
        await ClaudeProvider.Translate(turn, U("{\"sessionUpdate\":\"tool_call_update\",\"toolCallId\":\"t9\",\"title\":\"`pwd`\",\"status\":\"in_progress\"}"));
        Assert.IsTrue(events.Reader.TryRead(out var t9) && t9 is AgentTool { Title: "Terminal" });
        Assert.IsTrue(events.Reader.TryRead(out var t9b) && t9b is AgentTool { Title: "`pwd`", Status: "in_progress" });
        await ClaudeProvider.Translate(turn, U("{\"sessionUpdate\":\"tool_call_update\",\"toolCallId\":\"c1\",\"status\":\"completed\",\"content\":[{\"type\":\"content\",\"content\":{\"type\":\"text\",\"text\":\"a.md\"}}]}"));
        await ClaudeProvider.Translate(turn, U("{\"sessionUpdate\":\"tool_call\",\"toolCallId\":\"e1\",\"title\":\"Edit a.md\",\"kind\":\"edit\",\"status\":\"completed\",\"content\":[{\"type\":\"diff\",\"path\":\"/home/a.md\",\"oldText\":\"x\",\"newText\":\"y\"}]}"));
        await ClaudeProvider.Translate(turn, U("{\"sessionUpdate\":\"agent_message_chunk\",\"content\":{\"type\":\"text\",\"text\":\"One file.\"}}"));
        await ClaudeProvider.Translate(turn, U("{\"sessionUpdate\":\"plan\",\"entries\":[]}"));
        Assert.IsTrue(events.Reader.TryRead(out var done) && done is AgentTool { Id: "c1", Title: "`ls ~`", Status: "completed", Output: "a.md" });
        Assert.IsTrue(events.Reader.TryRead(out var editStarted) && editStarted is AgentTool { Id: "e1", Kind: "edit", Status: "in_progress" });
        Assert.IsTrue(events.Reader.TryRead(out var edited) && edited is AgentTool { Id: "e1", Status: "completed", Output: "Changed /home/a.md" });
        Assert.IsTrue(events.Reader.TryRead(out var text) && text is TextDelta { Text: "One file." });
        Assert.IsFalse(events.Reader.TryRead(out _), "a plan update gives the chat nothing");
        /* A stopped turn's permission is cancelled, as ACP asks. */
        turn.Cancelled = true;
        var late = await ClaudeProvider.Translate(turn, new AcpMessage("session/request_permission", (JsonObject)JsonNode.Parse(
            "{\"sessionId\":\"s1\",\"toolCall\":{\"toolCallId\":\"c2\"},\"options\":[{\"optionId\":\"allow\",\"name\":\"Allow\",\"kind\":\"allow_once\"}]}")!, JsonValue.Create(10)));
        Assert.AreEqual("cancelled", late!["outcome"]!["outcome"]!.GetValue<string>());
        Assert.IsNull(await ClaudeProvider.Translate(turn, new AcpMessage("fs/read_text_file", new JsonObject { ["sessionId"] = "s1" }, JsonValue.Create(11))), "the chat offers no files to read");
    }

    [TestMethod]
    public void ClaudeGetsOneCredentialAndNeverTheServersApiKeyUnlessAsked() {
        var saved = new[] { "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_TEST_KEY" }.ToDictionary(v => v, Environment.GetEnvironmentVariable);
        try {
            Environment.SetEnvironmentVariable("ANTHROPIC_API_KEY", "server-key");
            Environment.SetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN", "stray");
            Environment.SetEnvironmentVariable("CLAUDE_TEST_KEY", "chosen-key");
            Environment.SetEnvironmentVariable("CLAUDE_CODE_OAUTH_TOKEN", null);
            var plan = new ChatProviderConfig { Id = "claude", Kind = "claude" };
            StringAssert.Contains(ClaudeHost.NotReady(plan), "claude setup-token");
            Environment.SetEnvironmentVariable("CLAUDE_CODE_OAUTH_TOKEN", "plan-token");
            Assert.IsNull(ClaudeHost.NotReady(plan));
            var (variable, value) = ClaudeHost.Credential(plan);
            var env = ClaudeHost.AdapterEnvironment(variable, value!);
            Assert.AreEqual("plan-token", env["CLAUDE_CODE_OAUTH_TOKEN"]);
            Assert.IsFalse(env.ContainsKey("ANTHROPIC_API_KEY"), "the server's own key would outrank the plan's token");
            Assert.IsFalse(env.ContainsKey("ANTHROPIC_AUTH_TOKEN"));
            Assert.AreEqual("1", env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"]);
            Assert.AreEqual(ClaudeHost.Home, env["CLAUDE_CONFIG_DIR"]);
            /* A provider with keyEnv bills that key, and the token stays out. */
            var keyed = new ChatProviderConfig { Id = "claude-api", Kind = "claude", KeyEnv = "CLAUDE_TEST_KEY" };
            (variable, value) = ClaudeHost.Credential(keyed);
            env = ClaudeHost.AdapterEnvironment(variable, value!);
            Assert.AreEqual("chosen-key", env["ANTHROPIC_API_KEY"]);
            Assert.IsFalse(env.ContainsKey("CLAUDE_CODE_OAUTH_TOKEN"));
            Assert.IsFalse(env.ContainsKey("CLAUDE_TEST_KEY"));
        }
        finally { foreach (var (k, v) in saved) { Environment.SetEnvironmentVariable(k, v); } }
    }

    [TestMethod]
    public void TheClaudeAdapterRunsOnlyWhenItWasInstalledFromTheImagesLockfile() {
        var root = Path.Combine(Path.GetTempPath(), "pc-claude-adapter-" + Guid.NewGuid().ToString("N"));
        var folder = Path.Combine(root, "claude-agent");
        var lockfile = Path.Combine(root, "release", "package-lock.json");
        try {
            Directory.CreateDirectory(Path.GetDirectoryName(lockfile)!);
            File.WriteAllText(lockfile, "{\"lockfileVersion\":3}");
            StringAssert.Contains(ClaudeHost.AdapterProblem(folder, lockfile), "not installed");
            StringAssert.Contains(ClaudeHost.AdapterProblem(folder, lockfile), "install-claude-agent");
            var script = Path.Combine(folder, ClaudeHost.AdapterScript);
            Directory.CreateDirectory(Path.GetDirectoryName(script)!);
            File.WriteAllText(script, "");
            StringAssert.Contains(ClaudeHost.AdapterProblem(folder, lockfile), "did not finish");
            var stamp = Path.Combine(folder, ClaudeHost.InstalledStamp);
            File.WriteAllText(stamp, new string('0', 64) + "\n");
            StringAssert.Contains(ClaudeHost.AdapterProblem(folder, lockfile), "another release");
            /* The install writes sha256sum's lowercase hex and a newline. */
            var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(lockfile))).ToLowerInvariant();
            File.WriteAllText(stamp, hash + "\n");
            Assert.IsNull(ClaudeHost.AdapterProblem(folder, lockfile));
        }
        finally { if (Directory.Exists(root)) { Directory.Delete(root, true); } }
    }

    [TestMethod]
    public void AProviderKeptForOneAccountIsOfferedToThatAccountAlone() {
        var config = new ChatConfig {
            Providers = { new ChatProviderConfig { Id = "ollama", BaseUrl = "http://x/" }, new ChatProviderConfig { Id = "claude", Kind = "claude", Users = new() { "paul@example.com" } } },
            DefaultProvider = "claude", DefaultModel = "opus"
        };
        var paul = new IdentityUser { Email = "Paul@Example.com", UserName = "paul" };
        var other = new IdentityUser { Email = "admin@example.com", UserName = "admin" };
        CollectionAssert.AreEqual(new[] { "ollama", "claude" }, config.VisibleTo(paul).Providers.Select(p => p.Id).ToList());
        Assert.AreEqual("claude", config.VisibleTo(paul).DefaultProvider);
        var theirs = config.VisibleTo(other);
        CollectionAssert.AreEqual(new[] { "ollama" }, theirs.Providers.Select(p => p.Id).ToList());
        Assert.AreEqual("ollama", theirs.DefaultProvider);
        Assert.IsNull(theirs.DefaultModel, "the default model belonged to the provider they cannot use");
        Assert.IsTrue(config.Find("claude")!.IsAgent);
        CollectionAssert.AreEqual(new[] { "default", "opus", "haiku" }, ClaudeProvider.OptionValues((JsonArray)JsonNode.Parse(
            "[{\"id\":\"mode\",\"options\":[{\"value\":\"plan\"}]},{\"id\":\"model\",\"options\":[{\"value\":\"default\"},{\"group\":\"g\",\"name\":\"More\",\"options\":[{\"value\":\"opus\"},{\"value\":\"haiku\"}]}]}]")!, "model").ToList());
    }

    [TestMethod]
    public async Task CodexsQuestionWithChoicesIsTheChatsQuestionAndTheLabelGoesBack() {
        var events = System.Threading.Channels.Channel.CreateUnbounded<ProviderEvent>();
        var turn = new CodexProvider.TurnState(events.Writer);
        var asked = CodexProvider.Translate(turn, new CodexMessage("item/tool/requestUserInput",
            (JsonObject)JsonNode.Parse("{\"threadId\":\"t1\",\"itemId\":\"i1\",\"questions\":[{\"id\":\"q1\",\"header\":\"Approve tool\",\"question\":\"Run parkscomputing.applet_invoke?\",\"options\":[{\"label\":\"Approve\",\"description\":\"Run it\"},{\"label\":\"Decline\",\"description\":\"Do not\"}]}]}")!, JsonValue.Create(3)));
        Assert.IsTrue(events.Reader.TryRead(out var e) && e is AgentApproval);
        var ap = (AgentApproval)e!;
        StringAssert.Contains(ap.Title, "applet_invoke");
        CollectionAssert.AreEqual(new[] { "choice_0", "choice_1" }, ap.Options.Select(o => o.Id).ToList());
        Assert.AreEqual("reject_once", ap.Options[1].Kind);
        ap.Answer.SetResult("choice_0");
        var answer = (await asked)!;
        Assert.AreEqual("Approve", answer["answers"]!["q1"]!["answers"]![0]!.GetValue<string>());
    }

    [TestMethod]
    public void CodexGetsTheNewestMessageAndOnFreshThreadsTheInstructionsAndHistory() {
        var messages = new List<ChatMessage> {
            new() { Role = "user", Parts = { ChatPart.TextPart("Hello") } },
            new() { Role = "assistant", Parts = { ChatPart.TextPart("Hi.") } },
            new() { Role = "user", Parts = { ChatPart.TextPart("List my files"), new ChatPart { Type = "image", MediaType = "image/png", Data = "AAAA" } } }
        };
        var fresh = CodexProvider.Input(new ProviderRequest("gpt-5-codex", "Be brief.", messages, Array.Empty<ToolSpec>(), true), true);
        StringAssert.Contains(fresh[0]!["text"]!.GetValue<string>(), "Instructions from the site:\nBe brief.");
        StringAssert.Contains(fresh[0]!["text"]!.GetValue<string>(), "Reader: Hello\nAssistant: Hi.");
        Assert.AreEqual("List my files", fresh[1]!["text"]!.GetValue<string>());
        Assert.AreEqual("data:image/png;base64,AAAA", fresh[2]!["url"]!.GetValue<string>());
        var resumed = CodexProvider.Input(new ProviderRequest("gpt-5-codex", "Be brief.", messages, Array.Empty<ToolSpec>(), true), false);
        Assert.AreEqual(2, resumed.Count);
        Assert.AreEqual("List my files", resumed[0]!["text"]!.GetValue<string>());
        var env = CodexHost.ScrubbedEnvironment();
        Assert.IsFalse(env.Keys.Any(k => k.Contains("KEY", StringComparison.OrdinalIgnoreCase) || k.Contains("SECRET", StringComparison.OrdinalIgnoreCase)), "no key or secret reaches Codex");
        Assert.IsTrue(env.ContainsKey("CODEX_HOME"));
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
    public void AnOpenAiRequestLeavesOutAReplyWithNothingItCanCarry() {
        var messages = new List<ChatMessage> {
            new() { Role = "user", Parts = { ChatPart.TextPart("Open Sudoku") } },
            new() { Role = "assistant", Parts = { new ChatPart { Type = "agent_tool", Id = "a1", Name = "ls", Status = "completed", Text = "a.md" } } },
            new() { Role = "user", Parts = { ChatPart.TextPart("And?") } }
        };
        var body = OpenAiProvider.Body(new ProviderRequest("m", null, messages, Array.Empty<ToolSpec>(), false), null);
        var roles = body["messages"]!.AsArray().Select(x => x!["role"]!.GetValue<string>()).ToList();
        CollectionAssert.AreEqual(new[] { "user", "user" }, roles, "the agent's own steps are not a message this API takes, and content is never null");
    }

    [TestMethod]
    public void AnAnthropicRequestSendsThinkingBackOnlyWhenThinkingIsOn() {
        var on = AnthropicProvider.Body(Conversation(true), null, 2048);
        Assert.AreEqual("adaptive", on["thinking"]!["type"]!.GetValue<string>());
        Assert.AreEqual("summarized", on["thinking"]!["display"]!.GetValue<string>(), "the thinking text comes only when asked for");
        Assert.AreEqual("enabled", AnthropicProvider.Body(Conversation(true), null, 2048, "enabled")["thinking"]!["type"]!.GetValue<string>());
        Assert.IsTrue(AnthropicProvider.Body(Conversation(true), null, 2048, "enabled")["max_tokens"]!.GetValue<int>() > 2048);
        var assistant = on["messages"]![1]!["content"]!.AsArray();
        Assert.AreEqual("thinking", assistant[0]!["type"]!.GetValue<string>());
        Assert.AreEqual("sig", assistant[0]!["signature"]!.GetValue<string>());
        Assert.AreEqual("tool_result", on["messages"]![2]!["content"]![0]!["type"]!.GetValue<string>());
        Assert.IsFalse(on["messages"]![2]!["content"]![0]!["is_error"]!.GetValue<bool>());
        Assert.AreEqual("Be brief.", on["system"]!.GetValue<string>());

        var off = AnthropicProvider.Body(Conversation(false), null, null);
        Assert.AreEqual("disabled", off["thinking"]!["type"]!.GetValue<string>(), "the current models think unless told not to");
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
