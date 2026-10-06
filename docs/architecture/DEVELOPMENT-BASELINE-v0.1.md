# Development baseline v0.1

Status: adopted for FOUNDATION-001.

## Runtime choices

- Node.js 24 LTS, constrained to major 24; local version at adoption: 24.19.0.
- npm 11, constrained to major 11; local version: 11.17.0.
- .NET 10 LTS, pinned by `global.json` to SDK 10.0.302 with latest-patch roll-forward.
- PowerShell 5.1.19041.6456 available for development scripts.
- PowerShell 7 and pnpm were not installed and are not required.
- Windows 10 build 19045, x64.

Node 24 and .NET 10 were selected because they are current LTS lines, not merely because they were installed. In this workstation the ideal and available major versions coincide. The project does not alter globally installed runtimes.

Official lifecycle references: [Node.js releases](https://nodejs.org/en/about/previous-releases) and [.NET support policy](https://dotnet.microsoft.com/platform/support/policy/dotnet-core).

## Reproducibility

JavaScript dependencies are locked by `package-lock.json`; .NET SDK is pinned by `global.json`; NuGet dependencies use exact project versions. `scripts/verify.ps1` restores from these declarations, builds both runtimes and runs all tests. Build output and restored dependencies are ignored by Git.
