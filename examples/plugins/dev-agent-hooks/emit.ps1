param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("session_started", "working", "waiting_for_user", "completed", "failed", "stopped")]
  [string]$State,

  [Parameter(Mandatory = $true)]
  [string]$Credential,

  [string]$Tylpet = "",
  [string]$CorrelationId = ""
)

if (-not $Tylpet) {
  $Tylpet = Join-Path $PSScriptRoot "..\..\..\src-tauri\target\debug\tylpet.exe"
}

if (-not (Test-Path -LiteralPath $Tylpet -PathType Leaf)) {
  Write-Error "Tylpet executable not found: $Tylpet. Run npm run tauri dev first, or pass -Tylpet."
  exit 2
}

if (-not (Test-Path -LiteralPath $Credential -PathType Leaf)) {
  Write-Error "Plugin credential not found: $Credential. Pass the generated credential.v1.json, not ltypet.plugin.json."
  exit 2
}

try {
  $credentialDocument = Get-Content -LiteralPath $Credential -Raw -Encoding utf8 | ConvertFrom-Json -ErrorAction Stop
  if ($credentialDocument.schemaVersion -ne 1 -or
      -not $credentialDocument.pluginId -or
      -not $credentialDocument.token -or
      -not $credentialDocument.address) {
    throw "Missing v1 credential fields"
  }
} catch {
  Write-Error "Invalid plugin credential: $Credential. Pass the credential.v1.json shown after installation, not ltypet.plugin.json."
  exit 2
}

$Tylpet = (Resolve-Path -LiteralPath $Tylpet).Path
$Credential = (Resolve-Path -LiteralPath $Credential).Path

$arguments = @(
  "emit",
  "--credential", $Credential,
  "--type", "dev-agent.status",
  "--state", $State
)

if ($CorrelationId) {
  $arguments += @("--correlation-id", $CorrelationId)
}

& $Tylpet @arguments
exit $LASTEXITCODE
