using System.Text.Json;
using MasterSupport.Agent.Capabilities;

namespace MasterSupport.Agent.Tests;

[TestClass]
public sealed class PreflightCapabilityTests
{
    [TestMethod]
    public void RegistryAnnouncesExactlyFiveR0ReadOnlyNonAdminCapabilities()
    {
        var registry=new CapabilityRegistry(); var expected=new[]{"system.runtime.summary","windows.os.summary","windows.memory.summary","windows.storage.summary","windows.execution-context.summary"};
        CollectionAssert.AreEquivalent(expected,registry.AnnouncedCapabilities.Select(item=>item.Id).ToArray());
        foreach(var item in registry.AnnouncedCapabilities){var registration=registry.Find(item.Id,item.Version)!;Assert.AreEqual(CapabilityRisk.R0,registration.Risk);Assert.AreEqual(CapabilityMutability.ReadOnly,registration.Mutability);Assert.IsFalse(registration.RequiresAdmin);}
    }

    [TestMethod]
    public async Task WindowsHandlersReturnBoundedMinimalFactsWithNoIdentitySecrets()
    {
        if(!OperatingSystem.IsWindows())return; var handlers=new IObservationCapabilityHandler[]{new WindowsOsSummaryHandler(),new WindowsMemorySummaryHandler(),new WindowsStorageSummaryHandler(),new WindowsExecutionContextSummaryHandler()};
        foreach(var handler in handlers){var json=JsonSerializer.Serialize(await handler.CollectAsync(CancellationToken.None),ContractService.SerializerOptions);
            using var document=JsonDocument.Parse(json);var keys=document.RootElement.EnumerateObject().Select(item=>item.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
            Assert.IsFalse(keys.Any(key=>new[]{"username","sid","domain","email","mac","ip","serial","processes","token","credential"}.Contains(key,StringComparer.OrdinalIgnoreCase)));}
    }

    [TestMethod]
    public async Task MemoryStorageAndExecutionValuesAreCoherent()
    {
        if(!OperatingSystem.IsWindows())return;
        using var memory=JsonDocument.Parse(JsonSerializer.Serialize(await new WindowsMemorySummaryHandler().CollectAsync(CancellationToken.None),ContractService.SerializerOptions));
        var total=memory.RootElement.GetProperty("totalPhysicalMemoryBytes").GetUInt64();var available=memory.RootElement.GetProperty("availablePhysicalMemoryBytes").GetUInt64();
        Assert.IsLessThanOrEqualTo(total,available);Assert.AreEqual(total-available,memory.RootElement.GetProperty("usedPhysicalMemoryBytes").GetUInt64());
        using var storage=JsonDocument.Parse(JsonSerializer.Serialize(await new WindowsStorageSummaryHandler().CollectAsync(CancellationToken.None),ContractService.SerializerOptions));
        Assert.IsLessThanOrEqualTo(WindowsStorageSummaryHandler.MaxVolumes,storage.RootElement.GetProperty("volumes").GetArrayLength());
        foreach(var volume in storage.RootElement.GetProperty("volumes").EnumerateArray()){Assert.AreEqual("fixed",volume.GetProperty("driveType").GetString());Assert.IsLessThanOrEqualTo(volume.GetProperty("totalBytes").GetInt64(),volume.GetProperty("freeBytes").GetInt64());}
        using var execution=JsonDocument.Parse(JsonSerializer.Serialize(await new WindowsExecutionContextSummaryHandler().CollectAsync(CancellationToken.None),ContractService.SerializerOptions));
        var bitnessKind=execution.RootElement.GetProperty("is64BitProcess").ValueKind;
        Assert.IsTrue(bitnessKind is JsonValueKind.True or JsonValueKind.False);
        Assert.IsFalse(execution.RootElement.TryGetProperty("username",out _));Assert.IsFalse(execution.RootElement.TryGetProperty("sid",out _));
    }
}
