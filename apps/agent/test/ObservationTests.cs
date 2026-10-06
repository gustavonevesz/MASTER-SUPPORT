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

    private static string Request(Guid sessionId, Guid requestId, string capabilityId = "system.runtime.summary", int timeoutMs = 5000, int maxPayloadBytes = 16384) =>
        JsonSerializer.Serialize(new
        {
            protocolVersion = "1.0", messageId = Guid.NewGuid(), messageType = "observation.request", sessionId,
            correlationId = requestId, timestamp = DateTimeOffset.UtcNow,
            payload = new { requestId, capabilityId, capabilityVersion = "1.0", timeoutMs, maxPayloadBytes },
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
        public async Task<object> CollectAsync(CancellationToken cancellationToken)
        {
            await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken);
            return new { value = "late" };
        }
    }

    private sealed class FakeTransport : IAgentTransport
    {
        public List<string> Sent { get; } = [];
        public AgentConnectionState State => AgentConnectionState.Open;
        public Task ConnectAsync(Uri uri, CancellationToken cancellationToken) => Task.CompletedTask;
        public Task SendAsync(string message, CancellationToken cancellationToken) { Sent.Add(message); return Task.CompletedTask; }
        public Task<string?> ReceiveAsync(CancellationToken cancellationToken) => Task.FromResult<string?>(null);
        public Task CloseAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
