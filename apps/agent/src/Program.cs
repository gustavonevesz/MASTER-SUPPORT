using MasterSupport.Agent;
using System.Net.WebSockets;

return await RunAsync(args);

static async Task<int> RunAsync(string[] args)
{
    if (args.Length == 0)
    {
        Console.WriteLine("Master Support Agent");
        Console.WriteLine($"Version: {AgentHelloFactory.AgentVersion}");
        Console.WriteLine($"Protocol: {AgentHelloFactory.ProtocolVersion}");
        Console.WriteLine("Mode: SupportSession");
        Console.WriteLine("Status: Ready");
        return 0;
    }

    var contracts = new ContractService();
    try
    {
        switch (args[0])
        {
            case "connect-dev":
                var uri = new Uri(args.Length >= 2 ? args[1] : "ws://127.0.0.1:3000/session");
                int? heartbeatLimit = args.Length >= 3 ? int.Parse(args[2], System.Globalization.CultureInfo.InvariantCulture) : null;
                using (var cancellation = new CancellationTokenSource())
                {
                    Console.CancelKeyPress += (_, eventArgs) => { eventArgs.Cancel = true; cancellation.Cancel(); };
                    await using var transport = new MasterSupport.Agent.Transport.WebSocketAgentTransport();
                    return await new DevSessionClient(transport).RunAsync(uri, heartbeatLimit, cancellation.Token);
                }
            case "emit-agent-hello" when args.Length == 2:
                var hello = AgentHelloFactory.Create();
                await File.WriteAllTextAsync(args[1], contracts.SerializeAgentHello(hello));
                StructuredLog.Write("info", "agent_hello.emitted", hello.MessageId);
                return 0;
            case "validate-agent-hello" when args.Length == 2:
                var json = await File.ReadAllTextAsync(args[1]);
                var parsed = contracts.DeserializeAgentHello(json);
                StructuredLog.Write("info", "agent_hello.validated", parsed.MessageId);
                return 0;
            default:
                Console.Error.WriteLine("Usage: agent [connect-dev [ws-url] [heartbeat-count]|emit-agent-hello <path>|validate-agent-hello <path>]");
                return 2;
        }
    }
    catch (Exception exception) when (exception is IOException or System.Text.Json.JsonException or WebSocketException or OperationCanceledException or FormatException)
    {
        StructuredLog.Write("error", "agent_hello.rejected");
        Console.Error.WriteLine(exception.Message);
        return 1;
    }
}
