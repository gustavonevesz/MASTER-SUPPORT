namespace MasterSupport.Agent.Capabilities;

public enum CapabilityRisk { R0 }
public enum CapabilityMutability { ReadOnly }

public interface IObservationCapabilityHandler
{
    Task<object> CollectAsync(CancellationToken cancellationToken);
}

public sealed record CapabilityRegistration(
    string CapabilityId,
    string Version,
    CapabilityRisk Risk,
    CapabilityMutability Mutability,
    bool RequiresAdmin,
    IObservationCapabilityHandler Handler);

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
        ];
        _registrations = values.ToDictionary(value => Key(value.CapabilityId, value.Version), StringComparer.Ordinal);
    }

    public IReadOnlyList<CapabilityDescriptor> AnnouncedCapabilities => _registrations.Values
        .Select(value => new CapabilityDescriptor(value.CapabilityId, value.Version)).ToArray();

    public CapabilityRegistration? Find(string capabilityId, string version) =>
        _registrations.GetValueOrDefault(Key(capabilityId, version));

    private static string Key(string id, string version) => $"{id}@{version}";
}
