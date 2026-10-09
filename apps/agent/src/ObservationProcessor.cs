using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using MasterSupport.Agent.Capabilities;
using MasterSupport.Agent.Transport;

namespace MasterSupport.Agent;

public sealed record ActiveObservation(Guid SessionId, Guid RequestId, string CapabilityId, DateTimeOffset StartedAt, CancellationTokenSource Cancellation, string State)
{
    public string? CancelReason { get; set; }
    public TaskCompletionSource Completion { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
}

public sealed class ObservationProcessor
{
    private readonly ContractService _contracts = new();
    private readonly CapabilityRegistry _registry;
    private readonly int _deduplicationCapacity;
    private readonly int _maxActivePerSession;
    private readonly int _maxActivePerCapability;
    private readonly Dictionary<Guid, string> _completed = [];
    private readonly Queue<Guid> _completionOrder = [];
    private readonly object _completedLock = new();
    private readonly ConcurrentDictionary<Guid, ActiveObservation> _active = new();

    public ObservationProcessor(CapabilityRegistry? registry = null, int deduplicationCapacity = 100,
        int maxActivePerSession = 2, int maxActivePerCapability = 1)
    {
        _registry = registry ?? new CapabilityRegistry();
        _deduplicationCapacity = deduplicationCapacity;
        _maxActivePerSession = maxActivePerSession;
        _maxActivePerCapability = maxActivePerCapability;
    }

    public int ActiveCount => _active.Count;

    public async Task HandleAsync(string json, Guid currentSessionId, IReadOnlySet<string> negotiatedCapabilities,
        IAgentTransport transport, CancellationToken connectionCancellation)
    {
        EnsureValid(json, "observation-request.schema.json");
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        var payload = root.GetProperty("payload");
        var requestId = payload.GetProperty("requestId").GetGuid();
        string? cached;
        lock (_completedLock) _completed.TryGetValue(requestId, out cached);
        if (cached is not null) { await SafeSendAsync(cached, transport, connectionCancellation); return; }
        if (_active.ContainsKey(requestId))
        {
            await SafeSendAsync(Failure(currentSessionId, requestId, "duplicate_request", "Request is already executing."), transport, connectionCancellation);
            return;
        }
        if (root.GetProperty("sessionId").GetGuid() != currentSessionId)
        {
            await CompleteFailureAsync(currentSessionId, requestId, "invalid_session", "Request session does not match the active session.", transport, connectionCancellation);
            return;
        }
        var capabilityId = payload.GetProperty("capabilityId").GetString()!;
        var capabilityVersion = payload.GetProperty("capabilityVersion").GetString()!;
        var registration = _registry.Find(capabilityId, capabilityVersion);
        if (registration is null || !negotiatedCapabilities.Contains($"{capabilityId}@{capabilityVersion}") ||
            registration.Risk != CapabilityRisk.R0 || registration.Mutability != CapabilityMutability.ReadOnly || registration.RequiresAdmin)
        {
            await CompleteFailureAsync(currentSessionId, requestId, "unknown_capability", "Capability is not present in the negotiated read-only registry.", transport, connectionCancellation);
            return;
        }
        var deadline = payload.GetProperty("deadline").GetDateTimeOffset();
        if (deadline <= DateTimeOffset.UtcNow)
        {
            await CompleteFailureAsync(currentSessionId, requestId, "deadline_expired", "Observation deadline has already expired.", transport, connectionCancellation);
            return;
        }
        if (_active.Values.Count(item => item.SessionId == currentSessionId) >= _maxActivePerSession ||
            _active.Values.Count(item => item.SessionId == currentSessionId && item.CapabilityId == capabilityId) >= _maxActivePerCapability)
        {
            await CompleteFailureAsync(currentSessionId, requestId, "concurrency_limit", "Agent observation concurrency limit was reached.", transport, connectionCancellation);
            return;
        }

        var cancellation = CancellationTokenSource.CreateLinkedTokenSource(connectionCancellation);
        var remaining = deadline - DateTimeOffset.UtcNow;
        var timeout = TimeSpan.FromMilliseconds(Math.Min(payload.GetProperty("timeoutMs").GetInt32(), Math.Max(1, remaining.TotalMilliseconds)));
        cancellation.CancelAfter(timeout);
        var active = new ActiveObservation(currentSessionId, requestId, capabilityId, DateTimeOffset.UtcNow, cancellation, "executing");
        if (!_active.TryAdd(requestId, active)) { cancellation.Dispose(); return; }
        try
        {
            await SafeSendAsync(Envelope("observation.accepted", currentSessionId, requestId, new { requestId }), transport, connectionCancellation);
            Console.WriteLine($"Observation requested: {requestId:D} {capabilityId}@{capabilityVersion}");
            try
            {
                var collected = await registration.Handler.CollectAsync(cancellation.Token);
                cancellation.Token.ThrowIfCancellationRequested();
                var now = DateTimeOffset.UtcNow;
                if (now > deadline) throw new OperationCanceledException(cancellation.Token);
                var evidenceId = Guid.NewGuid(); var observationId = Guid.NewGuid();
                var resultPayload = new { requestId, evidence = new { evidenceId, capabilityId, capabilityVersion, collectedAt = now,
                    source = registration.Source, dataHandlingState = "RAW", payload = collected },
                    observation = new { observationId, evidenceId, observedAt = now, kind = registration.ObservationKind,
                      statement = registration.Statement, facts = collected } };
                var maxPayloadBytes = payload.GetProperty("maxPayloadBytes").GetInt32();
                if (Encoding.UTF8.GetByteCount(JsonSerializer.Serialize(resultPayload, ContractService.SerializerOptions)) > maxPayloadBytes)
                {
                    await CompleteFailureAsync(currentSessionId, requestId, "payload_too_large", "Observation result exceeds the payload limit.", transport, connectionCancellation);
                    return;
                }
                var result = Envelope("observation.result", currentSessionId, requestId, resultPayload);
                EnsureValid(result, "observation-result.schema.json"); Remember(requestId, result);
                await SafeSendAsync(result, transport, connectionCancellation);
                StructuredLog.WriteObservation("info", "observation.completed", currentSessionId, requestId, capabilityId, "completed",
                    evidenceId, observationId, Encoding.UTF8.GetByteCount(result));
                Console.WriteLine($"Observation completed: {requestId:D} ({Math.Max(0, (long)(now - active.StartedAt).TotalMilliseconds)} ms)");
            }
            catch (OperationCanceledException)
            {
                if (active.CancelReason is not null)
                {
                    var cancelled = Envelope("observation.cancelled", currentSessionId, requestId, new { requestId, status = "cancelled" });
                    EnsureValid(cancelled, "observation-cancelled.schema.json"); Remember(requestId, cancelled);
                    await SafeSendAsync(cancelled, transport, CancellationToken.None);
                    StructuredLog.WriteObservation("info", "observation.cancelled", currentSessionId, requestId, capabilityId, "cancelled");
                }
                else await CompleteFailureAsync(currentSessionId, requestId, "timeout", "Observation handler timed out.", transport, CancellationToken.None);
            }
            catch (UnsupportedPlatformException)
            {
                await CompleteFailureAsync(currentSessionId, requestId, "unsupported_platform", "Capability requires Windows.", transport, CancellationToken.None);
            }
            catch (Exception)
            {
                await CompleteFailureAsync(currentSessionId, requestId, "handler_failed", "Observation handler failed.", transport, CancellationToken.None);
            }
        }
        finally
        {
            _active.TryRemove(requestId, out _); cancellation.Dispose(); active.Completion.TrySetResult();
        }
    }

    public async Task HandleCancelAsync(string json, Guid currentSessionId, IAgentTransport transport, CancellationToken cancellationToken)
    {
        EnsureValid(json, "observation-cancel.schema.json");
        using var document = JsonDocument.Parse(json); var root = document.RootElement; var payload = root.GetProperty("payload");
        var requestId = payload.GetProperty("requestId").GetGuid();
        if (root.GetProperty("sessionId").GetGuid() != currentSessionId)
        {
            await SafeSendAsync(Envelope("observation.cancelled", currentSessionId, requestId, new { requestId, status = "not_found" }), transport, cancellationToken); return;
        }
        if (_active.TryGetValue(requestId, out var active)) { active.CancelReason ??= payload.GetProperty("reason").GetString(); active.Cancellation.Cancel(); return; }
        lock (_completedLock) { if (_completed.ContainsKey(requestId)) { } else requestId = Guid.Empty; }
        var status = requestId == Guid.Empty ? "not_found" : "already_terminal";
        var actualId = requestId == Guid.Empty ? payload.GetProperty("requestId").GetGuid() : requestId;
        await SafeSendAsync(Envelope("observation.cancelled", currentSessionId, actualId, new { requestId = actualId, status }), transport, cancellationToken);
    }

    public void CancelSession(Guid sessionId, string reason)
    {
        foreach (var active in _active.Values.Where(item => item.SessionId == sessionId)) { active.CancelReason ??= reason; active.Cancellation.Cancel(); }
    }
    public async Task WaitForSessionIdleAsync(Guid sessionId) =>
        await Task.WhenAll(_active.Values.Where(item => item.SessionId == sessionId).Select(item => item.Completion.Task));

    private async Task CompleteFailureAsync(Guid sessionId, Guid requestId, string code, string message, IAgentTransport transport, CancellationToken token)
    {
        var failure = Failure(sessionId, requestId, code, message); EnsureValid(failure, "observation-failed.schema.json");
        Remember(requestId, failure); await SafeSendAsync(failure, transport, token);
        StructuredLog.WriteObservation("error", "observation.completed", sessionId, requestId, null, code);
    }
    private static string Failure(Guid sessionId, Guid requestId, string code, string message) =>
        Envelope("observation.failed", sessionId, requestId, new { requestId, code, message });
    private void Remember(Guid requestId, string response)
    {
        lock (_completedLock) { _completed[requestId] = response; _completionOrder.Enqueue(requestId);
            while (_completionOrder.Count > _deduplicationCapacity) _completed.Remove(_completionOrder.Dequeue()); }
    }
    private static async Task SafeSendAsync(string message, IAgentTransport transport, CancellationToken token)
    {
        try { await transport.SendAsync(message, token); } catch (Exception) when (transport.State != AgentConnectionState.Open) { }
    }
    private static string Envelope(string type, Guid sessionId, Guid requestId, object payload) => JsonSerializer.Serialize(new
    { protocolVersion = "1.0", messageId = Guid.NewGuid(), messageType = type, sessionId, correlationId = requestId,
      timestamp = DateTimeOffset.UtcNow, payload }, ContractService.SerializerOptions);
    private void EnsureValid(string json, string schema)
    {
        var errors = _contracts.ValidateContract(json, schema); if (errors.Count > 0) throw new InvalidDataException(string.Join(Environment.NewLine, errors));
    }
}
