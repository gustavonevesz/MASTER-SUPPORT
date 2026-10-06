using System.Net.WebSockets;
using System.Text;

namespace MasterSupport.Agent.Transport;

public sealed class WebSocketAgentTransport : IAgentTransport
{
    private readonly ClientWebSocket _socket = new();
    public AgentConnectionState State => _socket.State switch
    {
        WebSocketState.None => AgentConnectionState.Disconnected,
        WebSocketState.Connecting => AgentConnectionState.Connecting,
        WebSocketState.Open => AgentConnectionState.Open,
        WebSocketState.CloseSent or WebSocketState.CloseReceived => AgentConnectionState.Closing,
        _ => AgentConnectionState.Closed,
    };

    public Task ConnectAsync(Uri uri, CancellationToken cancellationToken) => _socket.ConnectAsync(uri, cancellationToken);
    public Task SendAsync(string message, CancellationToken cancellationToken) =>
        _socket.SendAsync(Encoding.UTF8.GetBytes(message), WebSocketMessageType.Text, true, cancellationToken);

    public async Task<string?> ReceiveAsync(CancellationToken cancellationToken)
    {
        var buffer = new byte[4096];
        using var stream = new MemoryStream();
        while (true)
        {
            var result = await _socket.ReceiveAsync(buffer, cancellationToken);
            if (result.MessageType == WebSocketMessageType.Close) return null;
            stream.Write(buffer, 0, result.Count);
            if (stream.Length > 64 * 1024) throw new InvalidDataException("Protocol message exceeds 64 KiB.");
            if (result.EndOfMessage) return Encoding.UTF8.GetString(stream.ToArray());
        }
    }

    public async Task CloseAsync(CancellationToken cancellationToken)
    {
        if (_socket.State == WebSocketState.Open)
            await _socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "agent_closed", cancellationToken);
    }

    public ValueTask DisposeAsync()
    {
        _socket.Dispose();
        return ValueTask.CompletedTask;
    }
}
