using System.Text.Json;
using MasterSupport.Agent;

namespace MasterSupport.Agent.Tests;

[TestClass]
public sealed class ContractTests
{
    private readonly ContractService _contracts = new();

    [TestMethod]
    public void ValidFixtureDeserializesAndSerializes()
    {
        var hello = _contracts.DeserializeAgentHello(ReadFixture("agent-hello.valid.json"));
        Assert.AreEqual("1.0", hello.ProtocolVersion);
        Assert.AreEqual("agent.hello", hello.MessageType);
        Assert.IsEmpty(_contracts.ValidateAgentHello(_contracts.SerializeAgentHello(hello)));
    }

    [TestMethod]
    [DataRow("agent-hello.invalid-missing-version.json")]
    [DataRow("agent-hello.invalid-message-type.json")]
    [DataRow("agent-hello.unsupported-protocol.json")]
    public void InvalidFixturesAreRejected(string fixture)
    {
        Assert.ThrowsExactly<JsonException>(() => _contracts.DeserializeAgentHello(ReadFixture(fixture)));
    }

    [TestMethod]
    public void GeneratedHelloUsesTemporaryInstanceIdentityAndAnnouncesOnlyRuntimeSummary()
    {
        var first = AgentHelloFactory.Create();
        var second = AgentHelloFactory.Create();
        Assert.AreNotEqual(first.Payload.AgentInstanceId, second.Payload.AgentInstanceId);
        Assert.HasCount(1, first.Payload.SupportedCapabilities);
        Assert.AreEqual("system.runtime.summary", first.Payload.SupportedCapabilities[0].Id);
        Assert.AreEqual("1.0", first.Payload.SupportedCapabilities[0].Version);
        Assert.IsEmpty(_contracts.ValidateAgentHello(_contracts.SerializeAgentHello(first)));
    }

    [TestMethod]
    public void ValidatorRejectsUnknownSchemaKeywords()
    {
        using var instance = JsonDocument.Parse("{\"value\":true}");
        using var schema = JsonDocument.Parse("{\"type\":\"object\",\"if\":{}}");
        var errors = new JsonSchemaValidator().Validate(instance.RootElement, schema.RootElement);
        Assert.IsTrue(errors.Any(error => error.Contains("unsupported schema keyword", StringComparison.Ordinal)));
    }

    private static string ReadFixture(string name) => File.ReadAllText(Path.Combine(
        RepositoryLocator.FindRoot(), "tests", "fixtures", name));
}
