param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("session_started", "working", "waiting_for_user", "completed", "failed", "stopped")]
  [string]$State,

  [Parameter(Mandatory = $true)]
  [string]$Credential,

  [string]$Ltypet = "",
  [string]$CorrelationId = ""
)

if (-not $Ltypet) {
  $Ltypet = Join-Path $PSScriptRoot "..\..\..\src-tauri\target\debug\ltypet.exe"
}

if (-not (Test-Path -LiteralPath $Ltypet -PathType Leaf)) {
  Write-Error "ltypet executable not found: $Ltypet. Run npm run tauri dev first, or pass -Ltypet."
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

$Ltypet = (Resolve-Path -LiteralPath $Ltypet).Path
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

& $Ltypet @arguments
exit $LASTEXITCODE
