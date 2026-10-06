using System.Text.Json;
using MasterSupport.Agent;
using MasterSupport.Agent.Capabilities;
using MasterSupport.Agent.Transport;

namespace MasterSupport.Agent.Tests;

[TestClass]
public sealed class ObservationTests
{
    [TestMethod]
    public void RegistryContainsOneExplicitReadOnlyNonAdminCapability()
    {
        var registry = new CapabilityRegistry();
        var registration = registry.Find("system.runtime.summary", "1.0");
        Assert.IsNotNull(registration);
        Assert.AreEqual(CapabilityRisk.R0, registration.Risk);
        Assert.AreEqual(CapabilityMutability.ReadOnly, registration.Mutability);
        Assert.IsFalse(registration.RequiresAdmin);
        Assert.IsNull(registry.Find("anything.execute", "1.0"));
    }

    [TestMethod]
    public async Task DuplicateRequestReturnsCachedResultWithoutExecutingTwice()
    {
        var handler = new FakeHandler(RuntimePayload());
        var processor = CreateProcessor(handler);
        var transport = new FakeTransport();
        var sessionId = Guid.NewGuid();
        var request = Request(sessionId, Guid.NewGuid());
        await processor.HandleAsync(request, sessionId, Negotiated(), transport, CancellationToken.None);
        await processor.HandleAsync(request, sessionId, Negotiated(), transport, CancellationToken.None);
        Assert.AreEqual(1, handler.Invocations);
        Assert.HasCount(3, transport.Sent);
        Assert.AreEqual("observation.result", MessageType(transport.Sent[1]));
        Assert.AreEqual(transport.Sent[1], transport.Sent[2]);
    }

    [TestMethod]
    public async Task UnknownCapabilityAndWrongSessionAreRejectedWithoutHandlerExecution()
    {
        var handler = new FakeHandler(RuntimePayload());
        var processor = CreateProcessor(handler);
        var transport = new FakeTransport();
        var sessionId = Guid.NewGuid();
        await processor.HandleAsync(Request(sessionId, Guid.NewGuid(), "unknown.capability"), sessionId, Negotiated(), transport, CancellationToken.None);
        await processor.HandleAsync(Request(Guid.NewGuid(), Guid.NewGuid()), sessionId, Negotiated(), transport, CancellationToken.None);
        await processor.HandleAsync(Request(sessionId, Guid.NewGuid()), sessionId, new HashSet<string>(), transport, CancellationToken.None);
        Assert.AreEqual(0, handler.Invocations);
        Assert.IsTrue(transport.Sent.Any(message => FailureCode(message) == "unknown_capability"));
        Assert.IsTrue(transport.Sent.Any(message => FailureCode(message) == "invalid_session"));
    }

    [TestMethod]
    public async Task TimeoutAndPayloadLimitProduceStructuredFailures()
    {
        var sessionId = Guid.NewGuid();
        var slow = new ObservationProcessor(new CapabilityRegistry([Registration(new SlowHandler())]));
        var slowTransport = new FakeTransport();
        await slow.HandleAsync(Request(sessionId, Guid.NewGuid(), timeoutMs: 5), sessionId, Negotiated(), slowTransport, CancellationToken.None);
        Assert.IsTrue(slowTransport.Sent.Any(message => FailureCode(message) == "timeout"));

        var large = new ObservationProcessor(new CapabilityRegistry([Registration(new FakeHandler(RuntimePayload(new string('x', 1024))))]));
        var largeTransport = new FakeTransport();
        await large.HandleAsync(Request(sessionId, Guid.NewGuid(), maxPayloadBytes: 100), sessionId, Negotiated(), largeTransport, CancellationToken.None);
        Assert.IsTrue(largeTransport.Sent.Any(message => FailureCode(message) == "payload_too_large"));
    }

    [TestMethod]
    public async Task RuntimeSummaryProducesDistinctEvidenceAndObservationWithAllowedFields()
    {
        var processor = new ObservationProcessor();
        var transport = new FakeTransport();
        var sessionId = Guid.NewGuid();
        await processor.HandleAsync(Request(sessionId, Guid.NewGuid()), sessionId, Negotiated(), transport, CancellationToken.None);
        using var result = JsonDocument.Parse(transport.Sent.Single(message => MessageType(message) == "observation.result"));
        var payload = result.RootElement.GetProperty("payload");
        var evidence = payload.GetProperty("evidence");
        var observation = payload.GetProperty("observation");
        Assert.AreNotEqual(evidence.GetProperty("evidenceId").GetGuid(), observation.GetProperty("observationId").GetGuid());
        Assert.AreEqual(evidence.GetProperty("evidenceId").GetGuid(), observation.GetProperty("evidenceId").GetGuid());
        Assert.AreEqual("RAW", evidence.GetProperty("dataHandlingState").GetString());
        var fields = evidence.GetProperty("payload").EnumerateObject().Select(item => item.Name).ToHashSet();
        CollectionAssert.AreEquivalent(new[] { "osPlatform", "osDescription", "osArchitecture", "processArchitecture", "dotnetRuntime", "agentVersion", "productVersion", "protocolVersion", "supportSessionMode" }, fields.ToArray());
    }

    [TestMethod]
    public async Task ExplicitCancelIsIdempotentAndCancelsActiveHandler()
    {
        var handler = new BlockingHandler();
        var processor = CreateProcessor(handler);
        var transport = new FakeTransport();
        var sessionId = Guid.NewGuid();
        var requestId = Guid.NewGuid();
        var execution = processor.HandleAsync(Request(sessionId, requestId), sessionId, Negotiated(), transport, CancellationToken.None);
        await handler.Started.Task.WaitAsync(TimeSpan.FromSeconds(1));
        var cancel = Cancel(sessionId, requestId);
        await processor.HandleCancelAsync(cancel, sessionId, transport, CancellationToken.None);
        await processor.HandleCancelAsync(cancel, sessionId, transport, CancellationToken.None);
        await execution;
        Assert.AreEqual(1, handler.Invocations);
        Assert.IsTrue(transport.Snapshot().Any(message => MessageType(message) == "observation.cancelled"));
        Assert.AreEqual(0, processor.ActiveCount);
    }

    [TestMethod]
    public async Task SessionCancellationAndConcurrentDuplicateNeverReexecuteHandler()
    {
        var handler = new BlockingHandler();
        var processor = CreateProcessor(handler);
        var transport = new FakeTransport();
        var sessionId = Guid.NewGuid();
        var requestId = Guid.NewGuid();
        var request = Request(sessionId, requestId);
        var execution = processor.HandleAsync(request, sessionId, Negotiated(), transport, CancellationToken.None);
        await handler.Started.Task.WaitAsync(TimeSpan.FromSeconds(1));
        await processor.HandleAsync(request, sessionId, Negotiated(), transport, CancellationToken.None);
        processor.CancelSession(sessionId, "session_revoked");
        await processor.WaitForSessionIdleAsync(sessionId);
        await execution;
        Assert.AreEqual(1, handler.Invocations);
        Assert.IsTrue(transport.Snapshot().Any(message => FailureCode(message) == "duplicate_request"));
    }

    [TestMethod]
    public async Task ExpiredDeadlineAndConcurrencyLimitDoNotStartAnotherHandler()
    {
        var handler = new BlockingHandler();
        var processor = CreateProcessor(handler);
        var transport = new FakeTransport();
        var sessionId = Guid.NewGuid();
        await processor.HandleAsync(Request(sessionId, Guid.NewGuid(), deadline: DateTimeOffset.UtcNow.AddSeconds(-1)),
            sessionId, Negotiated(), transport, CancellationToken.None);
        Assert.AreEqual(0, handler.Invocations);
        Assert.IsTrue(transport.Snapshot().Any(message => FailureCode(message) == "deadline_expired"));

        var first = processor.HandleAsync(Request(sessionId, Guid.NewGuid()), sessionId, Negotiated(), transport, CancellationToken.None);
        await handler.Started.Task.WaitAsync(TimeSpan.FromSeconds(1));
        await processor.HandleAsync(Request(sessionId, Guid.NewGuid()), sessionId, Negotiated(), transport, CancellationToken.None);
        Assert.IsTrue(transport.Snapshot().Any(message => FailureCode(message) == "concurrency_limit"));
        processor.CancelSession(sessionId, "test_complete"); await first;
    }

    [TestMethod]
    public async Task DuplicatesAfterFailureTimeoutAndCancellationReturnTerminalCache()
    {
        var sessionId = Guid.NewGuid();

        var failedHandler = new FakeHandler(RuntimePayload(new string('x', 1024)));
        var failedProcessor = CreateProcessor(failedHandler); var failedTransport = new FakeTransport();
        var failedRequest = Request(sessionId, Guid.NewGuid(), maxPayloadBytes: 100);
        await failedProcessor.HandleAsync(failedRequest, sessionId, Negotiated(), failedTransport, CancellationToken.None);
        await failedProcessor.HandleAsync(failedRequest, sessionId, Negotiated(), failedTransport, CancellationToken.None);
        Assert.AreEqual(1, failedHandler.Invocations);
        Assert.AreEqual(failedTransport.Sent[^2], failedTransport.Sent[^1]);

        var timedOutHandler = new SlowHandler();
        var timedOutProcessor = CreateProcessor(timedOutHandler); var timedOutTransport = new FakeTransport();
        var timedOutRequest = Request(sessionId, Guid.NewGuid(), timeoutMs: 5);
        await timedOutProcessor.HandleAsync(timedOutRequest, sessionId, Negotiated(), timedOutTransport, CancellationToken.None);
        await timedOutProcessor.HandleAsync(timedOutRequest, sessionId, Negotiated(), timedOutTransport, CancellationToken.None);
        Assert.AreEqual(1, timedOutHandler.Invocations);
        Assert.AreEqual(timedOutTransport.Sent[^2], timedOutTransport.Sent[^1]);

        var cancelledHandler = new BlockingHandler();
        var cancelledProcessor = CreateProcessor(cancelledHandler); var cancelledTransport = new FakeTransport();
        var cancelledId = Guid.NewGuid(); var cancelledRequest = Request(sessionId, cancelledId);
        var execution = cancelledProcessor.HandleAsync(cancelledRequest, sessionId, Negotiated(), cancelledTransport, CancellationToken.None);
        await cancelledHandler.Started.Task.WaitAsync(TimeSpan.FromSeconds(1));
        await cancelledProcessor.HandleCancelAsync(Cancel(sessionId, cancelledId), sessionId, cancelledTransport, CancellationToken.None);
        await execution;
        await cancelledProcessor.HandleAsync(cancelledRequest, sessionId, Negotiated(), cancelledTransport, CancellationToken.None);
        Assert.AreEqual(1, cancelledHandler.Invocations);
        Assert.AreEqual(cancelledTransport.Sent[^2], cancelledTransport.Sent[^1]);
    }

    private static ObservationProcessor CreateProcessor(IObservationCapabilityHandler handler) =>
        new(new CapabilityRegistry([Registration(handler)]));

    private static IReadOnlySet<string> Negotiated() => new HashSet<string>(["system.runtime.summary@1.0"], StringComparer.Ordinal);

    private static CapabilityRegistration Registration(IObservationCapabilityHandler handler) =>
        new("system.runtime.summary", "1.0", CapabilityRisk.R0, CapabilityMutability.ReadOnly, false, handler);

    private static object RuntimePayload(string osDescription = "Windows") => new
    {
        osPlatform = "Windows", osDescription, osArchitecture = "x64", processArchitecture = "x64",
        dotnetRuntime = ".NET 10", agentVersion = "0.1.0", productVersion = "0.1.0",
        protocolVersion = "1.0", supportSessionMode = "temporary-development",
    };

    private static string Request(Guid sessionId, Guid requestId, string capabilityId = "system.runtime.summary", int timeoutMs = 5000,
        int maxPayloadBytes = 16384, DateTimeOffset? deadline = null) =>
        JsonSerializer.Serialize(new
        {
            protocolVersion = "1.0", messageId = Guid.NewGuid(), messageType = "observation.request", sessionId,
            correlationId = requestId, timestamp = DateTimeOffset.UtcNow,
            payload = new { requestId, capabilityId, capabilityVersion = "1.0", timeoutMs, maxPayloadBytes,
                deadline = deadline ?? DateTimeOffset.UtcNow.AddMilliseconds(timeoutMs) },
        }, ContractService.SerializerOptions);

    private static string Cancel(Guid sessionId, Guid requestId) => JsonSerializer.Serialize(new
    {
        protocolVersion = "1.0", messageId = Guid.NewGuid(), messageType = "observation.cancel", sessionId,
        correlationId = requestId, timestamp = DateTimeOffset.UtcNow, payload = new { requestId, reason = "requested" },
    }, ContractService.SerializerOptions);

    private static string? FailureCode(string json)
    {
        using var document = JsonDocument.Parse(json);
        return MessageType(json) == "observation.failed" ? document.RootElement.GetProperty("payload").GetProperty("code").GetString() : null;
    }

    private static string? MessageType(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.GetProperty("messageType").GetString();
    }

    private sealed class FakeHandler(object value) : IObservationCapabilityHandler
    {
        public int Invocations { get; private set; }
        public Task<object> CollectAsync(CancellationToken cancellationToken) { Invocations++; return Task.FromResult(value); }
    }

    private sealed class SlowHandler : IObservationCapabilityHandler
    {
        public int Invocations { get; private set; }
        public async Task<object> CollectAsync(CancellationToken cancellationToken)
        {
            Invocations++;
            await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken);
            return new { value = "late" };
        }
    }

    private sealed class BlockingHandler : IObservationCapabilityHandler
    {
        public int Invocations { get; private set; }
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public async Task<object> CollectAsync(CancellationToken cancellationToken)
        {
            Invocations++; Started.TrySetResult(); await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken); return RuntimePayload();
        }
    }

    private sealed class FakeTransport : IAgentTransport
    {
        private readonly List<string> _sent = [];
        public List<string> Sent => _sent;
        public string[] Snapshot() { lock (_sent) return [.. _sent]; }
        public AgentConnectionState State => AgentConnectionState.Open;
        public Task ConnectAsync(Uri uri, CancellationToken cancellationToken) => Task.CompletedTask;
        public Task SendAsync(string message, CancellationToken cancellationToken) { lock (_sent) _sent.Add(message); return Task.CompletedTask; }
        public Task<string?> ReceiveAsync(CancellationToken cancellationToken) => Task.FromResult<string?>(null);
        public Task CloseAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
