using System.Text.Json.Serialization;

namespace MasterSupport.Agent;

public sealed record CapabilityDescriptor(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("version")] string Version);

public sealed record AgentHelloPayload(
    [property: JsonPropertyName("agentVersion")] string AgentVersion,
    [property: JsonPropertyName("agentInstanceId")] Guid AgentInstanceId,
    [property: JsonPropertyName("supportedProtocolVersions")] IReadOnlyList<string> SupportedProtocolVersions,
    [property: JsonPropertyName("runtime")] string Runtime,
    [property: JsonPropertyName("os")] string Os,
    [property: JsonPropertyName("architecture")] string Architecture,
    [property: JsonPropertyName("supportedCapabilities")] IReadOnlyList<CapabilityDescriptor> SupportedCapabilities);

public sealed record AgentHello(
    [property: JsonPropertyName("protocolVersion")] string ProtocolVersion,
    [property: JsonPropertyName("messageId")] Guid MessageId,
    [property: JsonPropertyName("messageType")] string MessageType,
    [property: JsonPropertyName("timestamp")] DateTimeOffset Timestamp,
    [property: JsonPropertyName("payload")] AgentHelloPayload Payload);
