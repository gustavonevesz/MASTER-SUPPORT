using System.Text.Json;
using MasterSupport.Agent.Transport;

namespace MasterSupport.Agent;

public sealed class DevSessionClient
{
    private readonly ContractService _contracts = new();
    private readonly IAgentTransport _transport;
    private readonly ObservationProcessor _observations;
    public DevSessionClient(IAgentTransport transport, ObservationProcessor? observations = null)
    {
        _transport = transport;
        _observations = observations ?? new ObservationProcessor();
    }

    public async Task<int> RunAsync(Uri uri, int? heartbeatLimit, CancellationToken cancellationToken)
    {
        var hello = AgentHelloFactory.Create();
        await _transport.ConnectAsync(uri, cancellationToken);
        Console.WriteLine("Connected");
        await _transport.SendAsync(_contracts.SerializeAgentHello(hello), cancellationToken);
        var serverHelloJson = await _transport.ReceiveAsync(cancellationToken) ?? throw new IOException("Server closed during handshake.");
        EnsureValid(serverHelloJson, "server-hello.schema.json");
        using var serverHello = JsonDocument.Parse(serverHelloJson);
        var root = serverHello.RootElement;
        var sessionId = root.GetProperty("sessionId").GetGuid();
        var interval = root.GetProperty("payload").GetProperty("heartbeatIntervalSeconds").GetInt32();
        var negotiatedCapabilities = root.GetProperty("payload").GetProperty("negotiatedCapabilities").EnumerateArray()
            .Select(item => $"{item.GetProperty("id").GetString()}@{item.GetProperty("version").GetString()}")
            .ToHashSet(StringComparer.Ordinal);
        Console.WriteLine("Protocol: 1.0");
        Console.WriteLine($"Session: {sessionId:D}");

        var completed = 0;
        var pendingHeartbeats = new HashSet<Guid>();
        var observationTasks = new System.Collections.Concurrent.ConcurrentDictionary<Task, byte>();
        Task<string?> receive = _transport.ReceiveAsync(cancellationToken);
        var nextHeartbeat = Task.Delay(TimeSpan.FromSeconds(interval), cancellationToken);
        while (!cancellationToken.IsCancellationRequested && (heartbeatLimit is null || completed < heartbeatLimit))
        {
            Task finished;
            try { finished = await Task.WhenAny(receive, nextHeartbeat); }
            catch (OperationCanceledException) { break; }
            if (finished == nextHeartbeat)
            {
                var messageId = Guid.NewGuid();
                pendingHeartbeats.Add(messageId);
                await _transport.SendAsync(JsonSerializer.Serialize(new
                {
                    protocolVersion = "1.0", messageId, messageType = "heartbeat", sessionId,
                    timestamp = DateTimeOffset.UtcNow, payload = new { },
                }, ContractService.SerializerOptions), cancellationToken);
                nextHeartbeat = Task.Delay(TimeSpan.FromSeconds(interval), cancellationToken);
                continue;
            }

            var incoming = await receive;
            if (incoming is null)
            {
                _observations.CancelSession(sessionId, "disconnected");
                await _observations.WaitForSessionIdleAsync(sessionId);
                Console.WriteLine("Session ended by server; no further observation requests will be accepted.");
                return 0;
            }
            receive = _transport.ReceiveAsync(cancellationToken);
            using var message = JsonDocument.Parse(incoming);
            var messageType = message.RootElement.GetProperty("messageType").GetString();
            if (messageType == "heartbeat.ack")
            {
                EnsureValid(incoming, "heartbeat-ack.schema.json");
                var correlationId = message.RootElement.GetProperty("correlationId").GetGuid();
                if (!pendingHeartbeats.Remove(correlationId)) throw new InvalidDataException("HeartbeatAck correlation mismatch.");
                completed++;
                Console.WriteLine("Heartbeat OK");
            }
            else if (messageType == "observation.request")
            {
                var task = _observations.HandleAsync(incoming, sessionId, negotiatedCapabilities, _transport, cancellationToken);
                observationTasks.TryAdd(task, 0);
                _ = task.ContinueWith(completedTask => observationTasks.TryRemove(completedTask, out _), CancellationToken.None,
                    TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
            }
            else if (messageType == "observation.cancel")
            {
                await _observations.HandleCancelAsync(incoming, sessionId, _transport, cancellationToken);
            }
            else if (messageType == "protocol.error")
            {
                throw new InvalidDataException("Server rejected the active session message.");
            }
        }

        Console.WriteLine("Closing...");
        _observations.CancelSession(sessionId, "session_closed");
        await _observations.WaitForSessionIdleAsync(sessionId);
        var closeId = Guid.NewGuid();
        await _transport.SendAsync(JsonSerializer.Serialize(new
        {
            protocolVersion = "1.0", messageId = closeId, messageType = "session.close", sessionId,
            timestamp = DateTimeOffset.UtcNow, payload = new { },
        }, ContractService.SerializerOptions), CancellationToken.None);
        var closedJson = await receive ?? throw new IOException("Server closed before SessionClosed.");
        EnsureValid(closedJson, "session-closed.schema.json");
        await _transport.CloseAsync(CancellationToken.None);
        return 0;
    }

    private void EnsureValid(string json, string schema)
    {
        var errors = _contracts.ValidateContract(json, schema);
        if (errors.Count > 0) throw new InvalidDataException(string.Join(Environment.NewLine, errors));
    }
}
