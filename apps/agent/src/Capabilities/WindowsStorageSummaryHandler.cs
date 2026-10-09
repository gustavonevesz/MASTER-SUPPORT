namespace MasterSupport.Agent.Capabilities;

public sealed class WindowsStorageSummaryHandler : IObservationCapabilityHandler
{
    public const string CapabilityId = "windows.storage.summary"; public const int MaxVolumes = 32;
    public Task<object> CollectAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested(); if (!OperatingSystem.IsWindows()) throw new UnsupportedPlatformException();
        var volumes = DriveInfo.GetDrives().Where(drive => drive.DriveType == DriveType.Fixed && drive.IsReady).Take(MaxVolumes)
            .Select(drive => new { root = drive.RootDirectory.FullName, driveType = "fixed", fileSystem = drive.DriveFormat,
                totalBytes = drive.TotalSize, freeBytes = drive.TotalFreeSpace, availableBytes = drive.AvailableFreeSpace }).ToArray();
        return Task.FromResult<object>(new { volumes });
    }
}
