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
}
