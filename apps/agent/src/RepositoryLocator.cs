namespace MasterSupport.Agent;

public static class RepositoryLocator
{
    public static string FindRoot()
    {
        var configured = Environment.GetEnvironmentVariable("MASTER_SUPPORT_ROOT");
        if (!string.IsNullOrWhiteSpace(configured) && IsRoot(configured))
        {
            return Path.GetFullPath(configured);
        }

        foreach (var start in new[] { Environment.CurrentDirectory, AppContext.BaseDirectory })
        {
            var current = new DirectoryInfo(start);
            while (current is not null)
            {
                if (IsRoot(current.FullName))
                {
                    return current.FullName;
                }

                current = current.Parent;
            }
        }

        throw new DirectoryNotFoundException("Could not locate the Master Support repository root.");
    }

    private static bool IsRoot(string path) =>
        File.Exists(Path.Combine(path, "packages", "contracts", "schemas", "agent-hello.schema.json"));
}
