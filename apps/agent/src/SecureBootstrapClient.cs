using System.Net.Http.Json;
using System.Text.Json;

namespace MasterSupport.Agent;

public sealed record BootstrapResult(string ConnectionTicket, DateTimeOffset ExpiresAt, string WebsocketUrl);

public static class SecureBootstrapClient
{
    public static async Task<BootstrapResult> BootstrapAsync(Uri server, string code, AgentHello hello, string? testCaPath, CancellationToken cancellationToken)
    {
        if (server.Scheme != Uri.UriSchemeHttps) throw new InvalidOperationException("Secure connect requires an https:// server URL.");
        var separator = code.IndexOf('.');
        if (separator <= 0 || separator == code.Length - 1) throw new InvalidDataException("Support code is invalid.");
        using var handler = new HttpClientHandler();
        if (testCaPath is not null) handler.ServerCertificateCustomValidationCallback =
            (_, certificate, chain, errors) => TlsValidation.ValidateWithTestCa(certificate, chain, errors, testCaPath);
        using var client = new HttpClient(handler) { BaseAddress = server, Timeout = TimeSpan.FromSeconds(15) };
        using var response = await client.PostAsJsonAsync("support/bootstrap", new
        {
            invitationId = code[..separator], invitationSecret = code[(separator + 1)..], agentHello = hello
        }, ContractService.SerializerOptions, cancellationToken);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"Bootstrap rejected ({(int)response.StatusCode}).");
        var result = await response.Content.ReadFromJsonAsync<BootstrapResult>(ContractService.SerializerOptions, cancellationToken);
        return result ?? throw new InvalidDataException("Bootstrap response is invalid.");
    }
}
