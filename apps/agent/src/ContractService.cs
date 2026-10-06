using System.Text.Json;

namespace MasterSupport.Agent;

public sealed class ContractService
{
    public static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    private readonly JsonSchemaValidator _validator = new();

    public IReadOnlyList<string> ValidateAgentHello(string json)
    {
        return ValidateContract(json, "agent-hello.schema.json");
    }

    public IReadOnlyList<string> ValidateContract(string json, string schemaName)
    {
        using var instance = JsonDocument.Parse(json);
        using var schema = JsonDocument.Parse(File.ReadAllText(SchemaPath(schemaName)));
        return _validator.Validate(instance.RootElement, schema.RootElement);
    }

    public AgentHello DeserializeAgentHello(string json)
    {
        var errors = ValidateAgentHello(json);
        if (errors.Count > 0) throw new JsonException(string.Join(Environment.NewLine, errors));
        return JsonSerializer.Deserialize<AgentHello>(json, SerializerOptions)
            ?? throw new JsonException("AgentHello was null.");
    }

    public string SerializeAgentHello(AgentHello value) => JsonSerializer.Serialize(value, SerializerOptions);

    private static string SchemaPath(string name) =>
        Path.Combine(RepositoryLocator.FindRoot(), "packages", "contracts", "schemas", name);
}
