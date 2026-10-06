[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed with exit code $LASTEXITCODE."
    }
}

try {
    Write-Host '== Runtime versions =='
    Invoke-Checked node --version
    Invoke-Checked npm --version
    Invoke-Checked dotnet --version

    Write-Host '== TypeScript dependencies =='
    Invoke-Checked npm ci

    Write-Host '== .NET restore/build/tests =='
    Invoke-Checked dotnet restore apps/agent/test/MasterSupport.Agent.Tests.csproj
    Invoke-Checked dotnet build apps/agent/src/MasterSupport.Agent.csproj --no-restore --configuration Debug
    Invoke-Checked dotnet test apps/agent/test/MasterSupport.Agent.Tests.csproj --no-restore --configuration Debug

    Write-Host '== TypeScript typecheck/build/tests and cross-language round-trip =='
    Invoke-Checked npm run verify:ts

    Write-Host '== Repository checks =='
    Invoke-Checked git diff --check

    Write-Host 'FOUNDATION-002 verification succeeded.'
}
finally {
    Pop-Location
}
