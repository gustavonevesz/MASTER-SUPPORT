namespace MasterSupport.Agent.Transport;

public enum AgentConnectionState { Disconnected, Connecting, Open, Closing, Closed }

public interface IAgentTransport : IAsyncDisposable
{
    AgentConnectionState State { get; }
    Task ConnectAsync(Uri uri, CancellationToken cancellationToken);
    Task SendAsync(string message, CancellationToken cancellationToken);
    Task<string?> ReceiveAsync(CancellationToken cancellationToken);
    Task CloseAsync(CancellationToken cancellationToken);
}
