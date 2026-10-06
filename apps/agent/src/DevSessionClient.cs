using System.Text.Json;
using MasterSupport.Agent.Transport;

namespace MasterSupport.Agent;

public sealed class DevSessionClient
{
    private readonly ContractService _contracts = new();
    private readonly IAgentTransport _transport;
    public DevSessionClient(IAgentTransport transport) => _transport = transport;

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
        Console.WriteLine("Protocol: 1.0");
        Console.WriteLine($"Session: {sessionId:D}");

        var completed = 0;
        while (!cancellationToken.IsCancellationRequested && (heartbeatLimit is null || completed < heartbeatLimit))
        {
            try { await Task.Delay(TimeSpan.FromSeconds(interval), cancellationToken); }
            catch (OperationCanceledException) { break; }
            var messageId = Guid.NewGuid();
            await _transport.SendAsync(JsonSerializer.Serialize(new
            {
                protocolVersion = "1.0", messageId, messageType = "heartbeat", sessionId,
                timestamp = DateTimeOffset.UtcNow, payload = new { },
            }, ContractService.SerializerOptions), cancellationToken);
            var ackJson = await _transport.ReceiveAsync(cancellationToken) ?? throw new IOException("Server closed before HeartbeatAck.");
            EnsureValid(ackJson, "heartbeat-ack.schema.json");
            using var ack = JsonDocument.Parse(ackJson);
            if (ack.RootElement.GetProperty("correlationId").GetGuid() != messageId) throw new InvalidDataException("HeartbeatAck correlation mismatch.");
            completed++;
            Console.WriteLine("Heartbeat OK");
        }

        Console.WriteLine("Closing...");
        var closeId = Guid.NewGuid();
        await _transport.SendAsync(JsonSerializer.Serialize(new
        {
            protocolVersion = "1.0", messageId = closeId, messageType = "session.close", sessionId,
            timestamp = DateTimeOffset.UtcNow, payload = new { },
        }, ContractService.SerializerOptions), CancellationToken.None);
        var closedJson = await _transport.ReceiveAsync(CancellationToken.None) ?? throw new IOException("Server closed before SessionClosed.");
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
