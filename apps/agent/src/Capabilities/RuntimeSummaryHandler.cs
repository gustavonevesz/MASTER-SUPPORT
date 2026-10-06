using System.Runtime.InteropServices;

namespace MasterSupport.Agent.Capabilities;

public sealed class RuntimeSummaryHandler : IObservationCapabilityHandler
{
    public const string CapabilityId = "system.runtime.summary";
    public const string Version = "1.0";

    public Task<object> CollectAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        object result = new
        {
            osPlatform = GetPlatform(),
            osDescription = RuntimeInformation.OSDescription,
            osArchitecture = RuntimeInformation.OSArchitecture.ToString().ToLowerInvariant(),
            processArchitecture = RuntimeInformation.ProcessArchitecture.ToString().ToLowerInvariant(),
            dotnetRuntime = RuntimeInformation.FrameworkDescription,
            agentVersion = AgentHelloFactory.AgentVersion,
            productVersion = AgentHelloFactory.AgentVersion,
            protocolVersion = AgentHelloFactory.ProtocolVersion,
            supportSessionMode = "temporary-development",
        };
        return Task.FromResult(result);
    }

    private static string GetPlatform() =>
        OperatingSystem.IsWindows() ? "Windows" : OperatingSystem.IsLinux() ? "Linux" : OperatingSystem.IsMacOS() ? "macOS" : "Unknown";
}
