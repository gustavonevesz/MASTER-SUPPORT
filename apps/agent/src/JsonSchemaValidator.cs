using System.Globalization;
using System.Text.Json;

namespace MasterSupport.Agent;

public sealed class JsonSchemaValidator
{
    private static readonly HashSet<string> SupportedKeywords = new(StringComparer.Ordinal)
    {
        "$schema", "$id", "title", "type", "required", "properties", "additionalProperties",
        "const", "enum", "format", "minLength", "minItems", "uniqueItems", "items",
    };

    public IReadOnlyList<string> Validate(JsonElement instance, JsonElement schema)
    {
        var errors = new List<string>();
        ValidateNode(instance, schema, "$", errors);
        return errors;
    }

    private static void ValidateNode(JsonElement value, JsonElement schema, string path, List<string> errors)
    {
        foreach (var keyword in schema.EnumerateObject())
        {
            if (!SupportedKeywords.Contains(keyword.Name))
            {
                errors.Add($"{path}: unsupported schema keyword '{keyword.Name}'.");
            }
        }

        if (schema.TryGetProperty("type", out var type) && !MatchesType(value, type.GetString()))
        {
            errors.Add($"{path}: expected {type.GetString()}.");
            return;
        }

        if (schema.TryGetProperty("const", out var constant) && !JsonElement.DeepEquals(value, constant))
        {
            errors.Add($"{path}: value does not match const.");
        }

        if (schema.TryGetProperty("enum", out var enumValues) &&
            !enumValues.EnumerateArray().Any(item => JsonElement.DeepEquals(value, item)))
        {
            errors.Add($"{path}: value is not in enum.");
        }

        if (value.ValueKind == JsonValueKind.Object)
        {
            ValidateObject(value, schema, path, errors);
        }
        else if (value.ValueKind == JsonValueKind.Array)
        {
            ValidateArray(value, schema, path, errors);
        }
        else if (value.ValueKind == JsonValueKind.String)
        {
            ValidateString(value, schema, path, errors);
        }
    }

    private static void ValidateObject(JsonElement value, JsonElement schema, string path, List<string> errors)
    {
        if (schema.TryGetProperty("required", out var required))
        {
            foreach (var property in required.EnumerateArray().Select(item => item.GetString()!))
            {
                if (!value.TryGetProperty(property, out _)) errors.Add($"{path}: missing required property '{property}'.");
            }
        }

        var known = new HashSet<string>(StringComparer.Ordinal);
        if (schema.TryGetProperty("properties", out var properties))
        {
            foreach (var propertySchema in properties.EnumerateObject())
            {
                known.Add(propertySchema.Name);
                if (value.TryGetProperty(propertySchema.Name, out var child))
                {
                    ValidateNode(child, propertySchema.Value, $"{path}.{propertySchema.Name}", errors);
                }
            }
        }

        if (schema.TryGetProperty("additionalProperties", out var additional) && additional.ValueKind == JsonValueKind.False)
        {
            foreach (var property in value.EnumerateObject())
            {
                if (!known.Contains(property.Name)) errors.Add($"{path}: additional property '{property.Name}' is not allowed.");
            }
        }
    }

    private static void ValidateArray(JsonElement value, JsonElement schema, string path, List<string> errors)
    {
        var items = value.EnumerateArray().ToArray();
        if (schema.TryGetProperty("minItems", out var minimum) && items.Length < minimum.GetInt32())
        {
            errors.Add($"{path}: fewer than minItems.");
        }

        if (schema.TryGetProperty("uniqueItems", out var unique) && unique.GetBoolean())
        {
            var serialized = items.Select(item => item.GetRawText()).ToArray();
            if (serialized.Distinct(StringComparer.Ordinal).Count() != serialized.Length) errors.Add($"{path}: items are not unique.");
        }

        if (schema.TryGetProperty("items", out var itemSchema))
        {
            for (var index = 0; index < items.Length; index++) ValidateNode(items[index], itemSchema, $"{path}[{index}]", errors);
        }
    }

    private static void ValidateString(JsonElement value, JsonElement schema, string path, List<string> errors)
    {
        var text = value.GetString()!;
        if (schema.TryGetProperty("minLength", out var minimum) && text.Length < minimum.GetInt32())
        {
            errors.Add($"{path}: shorter than minLength.");
        }

        if (!schema.TryGetProperty("format", out var format)) return;
        var valid = format.GetString() switch
        {
            "uuid" => Guid.TryParseExact(text, "D", out _),
            "date-time" => DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out _),
            _ => true,
        };
        if (!valid) errors.Add($"{path}: invalid {format.GetString()} format.");
    }

    private static bool MatchesType(JsonElement value, string? type) => type switch
    {
        "object" => value.ValueKind == JsonValueKind.Object,
        "array" => value.ValueKind == JsonValueKind.Array,
        "string" => value.ValueKind == JsonValueKind.String,
        "boolean" => value.ValueKind is JsonValueKind.True or JsonValueKind.False,
        "integer" => value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out _),
        "number" => value.ValueKind == JsonValueKind.Number,
        "null" => value.ValueKind == JsonValueKind.Null,
        _ => true,
    };
}
