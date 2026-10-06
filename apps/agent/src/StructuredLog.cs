using System.Text.Json;

namespace MasterSupport.Agent;

public static class StructuredLog
{
    public static void Write(string level, string eventName, Guid? messageId = null) =>
        Console.Error.WriteLine(JsonSerializer.Serialize(new
        {
            timestamp = DateTimeOffset.UtcNow,
            level,
            component = "master-support-agent",
            @event = eventName,
            messageId,
        }, ContractService.SerializerOptions));

    public static void WriteObservation(
        string level, string eventName, Guid sessionId, Guid requestId, string? capabilityId, string status,
        Guid? evidenceId = null, Guid? observationId = null, int? payloadSize = null) =>
        Console.Error.WriteLine(JsonSerializer.Serialize(new
        {
            timestamp = DateTimeOffset.UtcNow,
            level,
            component = "master-support-agent",
            @event = eventName,
            sessionId,
            requestId,
            capabilityId,
            status,
            evidenceId,
            observationId,
            payloadSize,
        }, ContractService.SerializerOptions));
}
