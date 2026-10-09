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
            case "generate-test-certificates" when args.Length == 2:
                TestCertificateGenerator.Generate(args[1]);
                return 0;
            case "connect":
                var server = new Uri(args.Length >= 2 ? args[1] : Prompt("Server: "));
                if (server.Scheme != Uri.UriSchemeHttps) throw new InvalidOperationException("Secure connect requires HTTPS; no downgrade is available.");
                var code = ReadSecret("Support code: ");
                var secureHello = AgentHelloFactory.Create();
                var testCa = Environment.GetEnvironmentVariable("MASTER_SUPPORT_TEST_CA_CERT_PATH");
                var bootstrap = await SecureBootstrapClient.BootstrapAsync(server, code, secureHello, testCa, CancellationToken.None);
                var websocket = new UriBuilder(server) { Scheme = "wss", Path = bootstrap.WebsocketUrl, Query = "" }.Uri;
                int? secureHeartbeatLimit = args.Length >= 3 ? int.Parse(args[2], System.Globalization.CultureInfo.InvariantCulture) : null;
                using (var cancellation = new CancellationTokenSource())
                {
                    Console.CancelKeyPress += (_, eventArgs) => { eventArgs.Cancel = true; cancellation.Cancel(); };
                    await using var transport = new MasterSupport.Agent.Transport.WebSocketAgentTransport(bootstrap.ConnectionTicket, testCa);
                    return await new DevSessionClient(transport).RunAsync(websocket, secureHeartbeatLimit, cancellation.Token, secureHello,
                        ticket => new MasterSupport.Agent.Transport.WebSocketAgentTransport(ticket, testCa));
                }
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
            case "validate-contract" when args.Length == 3:
                var contractJson = await File.ReadAllTextAsync(args[2]);
                var errors = contracts.ValidateContract(contractJson, args[1]);
                if (errors.Count > 0) throw new System.Text.Json.JsonException(string.Join(Environment.NewLine, errors));
                StructuredLog.Write("info", "contract.validated");
                return 0;
            default:
                Console.Error.WriteLine("Usage: agent [connect [https-server]|connect-dev [ws-url] [heartbeat-count]|emit-agent-hello <path>|validate-agent-hello <path>|validate-contract <schema> <path>]");
                return 2;
        }
    }
    catch (Exception exception) when (exception is IOException or System.Text.Json.JsonException or WebSocketException or OperationCanceledException or FormatException or InvalidOperationException or HttpRequestException)
    {
        StructuredLog.Write("error", "agent_hello.rejected");
        Console.Error.WriteLine(exception.Message);
        return 1;
    }
}

static string Prompt(string label) { Console.Write(label); return Console.ReadLine() ?? ""; }
static string ReadSecret(string label)
{
    Console.Write(label);
    if (Console.IsInputRedirected) return Console.ReadLine() ?? "";
    var value = new System.Text.StringBuilder();
    while (true)
    {
        var key = Console.ReadKey(true);
        if (key.Key == ConsoleKey.Enter) { Console.WriteLine(); return value.ToString(); }
        if (key.Key == ConsoleKey.Backspace) { if (value.Length > 0) value.Length--; continue; }
        if (!char.IsControl(key.KeyChar)) value.Append(key.KeyChar);
    }
}
