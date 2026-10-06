using System.Text;
using System.Text.Json;
using MasterSupport.Agent.Capabilities;
using MasterSupport.Agent.Transport;

namespace MasterSupport.Agent;

public sealed class ObservationProcessor
{
    private readonly ContractService _contracts = new();
    private readonly CapabilityRegistry _registry;
    private readonly int _deduplicationCapacity;
    private readonly Dictionary<Guid, string> _completed = [];
    private readonly Queue<Guid> _completionOrder = [];
    private readonly HashSet<Guid> _executing = [];

    public ObservationProcessor(CapabilityRegistry? registry = null, int deduplicationCapacity = 100)
    {
        _registry = registry ?? new CapabilityRegistry();
        _deduplicationCapacity = deduplicationCapacity;
    }

    public async Task HandleAsync(
        string json,
        Guid currentSessionId,
        IReadOnlySet<string> negotiatedCapabilities,
        IAgentTransport transport,
        CancellationToken cancellationToken)
    {
        EnsureValid(json, "observation-request.schema.json");
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        var requestSessionId = root.GetProperty("sessionId").GetGuid();
        var payload = root.GetProperty("payload");
        var requestId = payload.GetProperty("requestId").GetGuid();
        if (_completed.TryGetValue(requestId, out var cached))
        {
            await transport.SendAsync(cached, cancellationToken);
            return;
        }
        if (!_executing.Add(requestId))
        {
            await SendFailureAsync(currentSessionId, requestId, "duplicate_request", "Request is already executing.", transport, cancellationToken);
            return;
        }

        try
        {
            if (requestSessionId != currentSessionId)
            {
                await CompleteFailureAsync(currentSessionId, requestId, "invalid_session", "Request session does not match the active session.", transport, cancellationToken);
                return;
            }
            var capabilityId = payload.GetProperty("capabilityId").GetString()!;
            var capabilityVersion = payload.GetProperty("capabilityVersion").GetString()!;
            var registration = _registry.Find(capabilityId, capabilityVersion);
            if (registration is null || !negotiatedCapabilities.Contains($"{capabilityId}@{capabilityVersion}") ||
                registration.Risk != CapabilityRisk.R0 || registration.Mutability != CapabilityMutability.ReadOnly || registration.RequiresAdmin)
            {
                await CompleteFailureAsync(currentSessionId, requestId, "unknown_capability", "Capability is not present in the local read-only registry.", transport, cancellationToken);
                return;
            }

            await transport.SendAsync(SerializeEnvelope("observation.accepted", currentSessionId, requestId, new { requestId }), cancellationToken);
            Console.WriteLine($"Observation requested: {requestId:D} {capabilityId}@{capabilityVersion}");
            var timeoutMs = payload.GetProperty("timeoutMs").GetInt32();
            var maxPayloadBytes = payload.GetProperty("maxPayloadBytes").GetInt32();
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromMilliseconds(timeoutMs));
            try
            {
                var started = System.Diagnostics.Stopwatch.StartNew();
                var collected = await registration.Handler.CollectAsync(timeout.Token);
                var now = DateTimeOffset.UtcNow;
                var evidenceId = Guid.NewGuid();
                var observationId = Guid.NewGuid();
                var resultPayload = new
                {
                    requestId,
                    evidence = new
                    {
                        evidenceId,
                        capabilityId,
                        capabilityVersion,
                        collectedAt = now,
                        source = "agent.native-runtime-api",
                        dataHandlingState = "RAW",
                        payload = collected,
                    },
                    observation = new
                    {
                        observationId,
                        evidenceId,
                        observedAt = now,
                        kind = "runtime-summary-collected",
                        statement = "The temporary Agent runtime has the reported platform and architecture properties.",
                        facts = collected,
                    },
                };
                if (Encoding.UTF8.GetByteCount(JsonSerializer.Serialize(resultPayload, ContractService.SerializerOptions)) > maxPayloadBytes)
                {
                    await CompleteFailureAsync(currentSessionId, requestId, "payload_too_large", "Observation result exceeds the payload limit.", transport, cancellationToken);
                    return;
                }
                var result = SerializeEnvelope("observation.result", currentSessionId, requestId, resultPayload);
                EnsureValid(result, "observation-result.schema.json");
                Remember(requestId, result);
                await transport.SendAsync(result, cancellationToken);
                StructuredLog.WriteObservation("info", "observation.completed", currentSessionId, requestId, capabilityId, "result", evidenceId, observationId, Encoding.UTF8.GetByteCount(result));
                Console.WriteLine($"Observation completed: {requestId:D} ({started.ElapsedMilliseconds} ms)");
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                await CompleteFailureAsync(currentSessionId, requestId, "timeout", "Observation handler timed out.", transport, cancellationToken);
            }
            catch (Exception)
            {
                await CompleteFailureAsync(currentSessionId, requestId, "handler_failed", "Observation handler failed.", transport, cancellationToken);
            }
        }
        finally
        {
            _executing.Remove(requestId);
        }
    }

    private async Task CompleteFailureAsync(Guid sessionId, Guid requestId, string code, string message, IAgentTransport transport, CancellationToken cancellationToken)
    {
        var failure = SerializeEnvelope("observation.failed", sessionId, requestId, new { requestId, code, message });
        EnsureValid(failure, "observation-failed.schema.json");
        Remember(requestId, failure);
        await transport.SendAsync(failure, cancellationToken);
        StructuredLog.WriteObservation("error", "observation.completed", sessionId, requestId, null, code);
    }

    private static Task SendFailureAsync(Guid sessionId, Guid requestId, string code, string message, IAgentTransport transport, CancellationToken cancellationToken) =>
        transport.SendAsync(SerializeEnvelope("observation.failed", sessionId, requestId, new { requestId, code, message }), cancellationToken);

    private void Remember(Guid requestId, string response)
    {
        _completed[requestId] = response;
        _completionOrder.Enqueue(requestId);
        while (_completionOrder.Count > _deduplicationCapacity) _completed.Remove(_completionOrder.Dequeue());
    }

    private static string SerializeEnvelope(string messageType, Guid sessionId, Guid requestId, object payload) => JsonSerializer.Serialize(new
    {
        protocolVersion = "1.0", messageId = Guid.NewGuid(), messageType, sessionId, correlationId = requestId,
        timestamp = DateTimeOffset.UtcNow, payload,
    }, ContractService.SerializerOptions);

    private void EnsureValid(string json, string schema)
    {
        var errors = _contracts.ValidateContract(json, schema);
        if (errors.Count > 0) throw new InvalidDataException(string.Join(Environment.NewLine, errors));
    }
}
