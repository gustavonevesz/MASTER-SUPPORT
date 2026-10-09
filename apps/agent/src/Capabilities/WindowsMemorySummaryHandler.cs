using System.Runtime.InteropServices;

namespace MasterSupport.Agent.Capabilities;

public sealed class WindowsMemorySummaryHandler : IObservationCapabilityHandler
{
    public const string CapabilityId = "windows.memory.summary";
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private sealed class MemoryStatus { public uint Length = (uint)Marshal.SizeOf<MemoryStatus>(); public uint Load;
        public ulong TotalPhysical; public ulong AvailablePhysical; public ulong TotalPageFile; public ulong AvailablePageFile;
        public ulong TotalVirtual; public ulong AvailableVirtual; public ulong AvailableExtendedVirtual; }
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx([In, Out] MemoryStatus buffer);
    public Task<object> CollectAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested(); if (!OperatingSystem.IsWindows()) throw new UnsupportedPlatformException();
        var status = new MemoryStatus(); if (!GlobalMemoryStatusEx(status)) throw new InvalidOperationException("Physical memory query failed.");
        return Task.FromResult<object>(new { totalPhysicalMemoryBytes = status.TotalPhysical,
            availablePhysicalMemoryBytes = status.AvailablePhysical, usedPhysicalMemoryBytes = status.TotalPhysical - status.AvailablePhysical });
    }
}
