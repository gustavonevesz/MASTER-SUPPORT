using System.Runtime.InteropServices;

namespace MasterSupport.Agent.Capabilities;

public sealed class WindowsOsSummaryHandler : IObservationCapabilityHandler
{
    public const string CapabilityId = "windows.os.summary";
    public Task<object> CollectAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!OperatingSystem.IsWindows()) throw new UnsupportedPlatformException();
        var version = Environment.OSVersion.Version;
        return Task.FromResult<object>(new { machineName = Environment.MachineName, osDescription = RuntimeInformation.OSDescription,
            osVersion = version.ToString(), windowsBuild = version.Build.ToString(System.Globalization.CultureInfo.InvariantCulture),
            osArchitecture = RuntimeInformation.OSArchitecture.ToString().ToLowerInvariant(),
            processArchitecture = RuntimeInformation.ProcessArchitecture.ToString().ToLowerInvariant(), uptimeMilliseconds = Environment.TickCount64 });
    }
}
