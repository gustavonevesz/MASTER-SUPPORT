[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceFiles = Get-ChildItem -Path (Join-Path $repoRoot 'apps') -Recurse -File |
    Where-Object { $_.Extension -in '.ts', '.cs', '.js' -and $_.FullName -notmatch '[\\/]bin[\\/]|[\\/]obj[\\/]|[\\/]test[\\/]' }
$forbidden = @(
    'DangerousAcceptAnyServerCertificateValidator',
    'NODE_TLS_REJECT_UNAUTHORIZED',
    'rejectUnauthorized\s*:\s*false',
    'ServerCertificateCustomValidationCallback\s*=\s*[^;]*=>\s*true',
    '[?&](token|ticket|secret)=',
    '\b(localStorage|sessionStorage)\b',
    'console\.log\s*\([^)]*(token|cookie|claims|authorization)',
    '(isTest|NODE_ENV\s*===?\s*["'']test)[^\r\n]*(allowAll|authenticated\s*=\s*true)',
    'origin\s*:\s*["'']\*["'']'
)
foreach ($pattern in $forbidden) {
    $matches = $sourceFiles | Select-String -Pattern $pattern
    if ($matches) { $matches | ForEach-Object { Write-Error "Forbidden security pattern: $($_.Path):$($_.LineNumber)" } }
}
$agentOperationalFiles = Get-ChildItem -Path (Join-Path $repoRoot 'apps/agent/src') -Recurse -File -Filter '*.cs'
$agentForbidden = @(
    'powershell\.exe',
    'pwsh\.exe',
    'cmd\.exe',
    'System\.Management',
    'Microsoft\.PowerShell',
    'Process\.Start',
    '\bSystem\.Management\.ManagementObject\b',
    '\bMicrosoft\.Management\.Infrastructure\b',
    '\bMicrosoft\.Win32\.Registry(Key|Hive|View)?\b'
)
foreach ($pattern in $agentForbidden) {
    $matches = $agentOperationalFiles | Select-String -Pattern $pattern
    if ($matches) { $matches | ForEach-Object { Write-Error "Forbidden Agent execution pattern: $($_.Path):$($_.LineNumber)" } }
}
Write-Host 'Security pattern checks passed.'
