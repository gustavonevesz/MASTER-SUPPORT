using System.Security.Principal;

namespace MasterSupport.Agent.Capabilities;

public sealed class WindowsExecutionContextSummaryHandler : IObservationCapabilityHandler
{
    public const string CapabilityId = "windows.execution-context.summary";
    public Task<object> CollectAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested(); if (!OperatingSystem.IsWindows()) throw new UnsupportedPlatformException();
        using var identity = WindowsIdentity.GetCurrent(); var elevated = new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
        return Task.FromResult<object>(new { isElevated = elevated, is64BitProcess = Environment.Is64BitProcess,
            is64BitOperatingSystem = Environment.Is64BitOperatingSystem, executionMode = "SupportSession",
            privilegeLevel = elevated ? "elevated" : "standard-user" });
    }
}
