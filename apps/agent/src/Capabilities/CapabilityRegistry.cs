namespace MasterSupport.Agent.Capabilities;

public enum CapabilityRisk { R0 }
public enum CapabilityMutability { ReadOnly }

public interface IObservationCapabilityHandler
{
    Task<object> CollectAsync(CancellationToken cancellationToken);
}

public sealed class UnsupportedPlatformException : Exception
{
    public UnsupportedPlatformException() : base("Capability requires Windows.") { }
}

public sealed record CapabilityRegistration(
    string CapabilityId,
    string Version,
    CapabilityRisk Risk,
    CapabilityMutability Mutability,
    bool RequiresAdmin,
    IObservationCapabilityHandler Handler,
    string Source = "agent.dotnet.runtime",
    string ObservationKind = "runtime-summary-collected",
    string Statement = "The temporary Agent runtime has the reported platform and architecture properties.");

public sealed class CapabilityRegistry
{
    private readonly IReadOnlyDictionary<string, CapabilityRegistration> _registrations;

    public CapabilityRegistry(IEnumerable<CapabilityRegistration>? registrations = null)
    {
        var values = registrations?.ToArray() ??
        [
            new CapabilityRegistration(
                RuntimeSummaryHandler.CapabilityId,
                RuntimeSummaryHandler.Version,
                CapabilityRisk.R0,
                CapabilityMutability.ReadOnly,
                false,
                new RuntimeSummaryHandler()),
            Registration(WindowsOsSummaryHandler.CapabilityId, new WindowsOsSummaryHandler(), "agent.dotnet.runtime", "windows-os-summary-collected", "Windows operating system facts were observed."),
            Registration(WindowsMemorySummaryHandler.CapabilityId, new WindowsMemorySummaryHandler(), "agent.win32.globalmemorystatusex", "windows-memory-summary-collected", "Windows physical memory capacity was observed."),
            Registration(WindowsStorageSummaryHandler.CapabilityId, new WindowsStorageSummaryHandler(), "agent.dotnet.driveinfo", "windows-storage-summary-collected", "Local fixed-volume capacity was observed."),
            Registration(WindowsExecutionContextSummaryHandler.CapabilityId, new WindowsExecutionContextSummaryHandler(), "agent.windows.security-context", "windows-execution-context-summary-collected", "Agent execution privilege context was observed."),
        ];
        _registrations = values.ToDictionary(value => Key(value.CapabilityId, value.Version), StringComparer.Ordinal);
    }

    public IReadOnlyList<CapabilityDescriptor> AnnouncedCapabilities => _registrations.Values
        .Select(value => new CapabilityDescriptor(value.CapabilityId, value.Version)).ToArray();

    public CapabilityRegistration? Find(string capabilityId, string version) =>
        _registrations.GetValueOrDefault(Key(capabilityId, version));

    private static string Key(string id, string version) => $"{id}@{version}";
    private static CapabilityRegistration Registration(string id, IObservationCapabilityHandler handler, string source, string kind, string statement) =>
        new(id, "1.0", CapabilityRisk.R0, CapabilityMutability.ReadOnly, false, handler, source, kind, statement);
}
