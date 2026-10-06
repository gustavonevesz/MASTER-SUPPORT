using System.Runtime.InteropServices;
using MasterSupport.Agent.Capabilities;

namespace MasterSupport.Agent;

public static class AgentHelloFactory
{
    public const string AgentVersion = "0.1.0";
    public const string ProtocolVersion = "1.0";

    public static AgentHello Create() => Create(new CapabilityRegistry());

    public static AgentHello Create(CapabilityRegistry registry) => new(
        ProtocolVersion,
        Guid.NewGuid(),
        "agent.hello",
        DateTimeOffset.UtcNow,
        new AgentHelloPayload(
            AgentVersion,
            Guid.NewGuid(),
            [ProtocolVersion],
            RuntimeInformation.FrameworkDescription,
            RuntimeInformation.OSDescription,
            RuntimeInformation.OSArchitecture.ToString().ToLowerInvariant(),
            registry.AnnouncedCapabilities));
}
