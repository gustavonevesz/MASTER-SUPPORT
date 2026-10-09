using System.Net.WebSockets;
using System.Text;

namespace MasterSupport.Agent.Transport;

public sealed class WebSocketAgentTransport : IAgentTransport
{
    private readonly ClientWebSocket _socket = new();
    private readonly SemaphoreSlim _sendGate = new(1, 1);
    private int _pendingSends;
    private const int MaxPendingSends = 4;
    public WebSocketAgentTransport(string? bearerToken = null, string? testCaPath = null)
    {
        if (bearerToken is not null) _socket.Options.SetRequestHeader("Authorization", $"Bearer {bearerToken}");
        if (testCaPath is not null) _socket.Options.RemoteCertificateValidationCallback =
            (_, certificate, chain, errors) => TlsValidation.ValidateWithTestCa(certificate, chain, errors, testCaPath);
    }
    public AgentConnectionState State => _socket.State switch
    {
        WebSocketState.None => AgentConnectionState.Disconnected,
        WebSocketState.Connecting => AgentConnectionState.Connecting,
        WebSocketState.Open => AgentConnectionState.Open,
        WebSocketState.CloseSent or WebSocketState.CloseReceived => AgentConnectionState.Closing,
        _ => AgentConnectionState.Closed,
    };

    public Task ConnectAsync(Uri uri, CancellationToken cancellationToken) => _socket.ConnectAsync(uri, cancellationToken);
    public async Task SendAsync(string message, CancellationToken cancellationToken)
    {
        if (Encoding.UTF8.GetByteCount(message) > 64 * 1024) throw new InvalidDataException("Protocol message exceeds 64 KiB.");
        if (Interlocked.Increment(ref _pendingSends) > MaxPendingSends)
        {
            Interlocked.Decrement(ref _pendingSends);
            throw new InvalidOperationException("Agent outbound backpressure limit reached.");
        }
        try
        {
            await _sendGate.WaitAsync(cancellationToken);
            try { await _socket.SendAsync(Encoding.UTF8.GetBytes(message), WebSocketMessageType.Text, true, cancellationToken); }
            finally { _sendGate.Release(); }
        }
        finally { Interlocked.Decrement(ref _pendingSends); }
    }

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
        _sendGate.Dispose();
        _socket.Dispose();
        return ValueTask.CompletedTask;
    }
}
