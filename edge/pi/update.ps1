# Atualiza o agente num Pi via Tailscale SSH (roda no seu PC).
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File edge/pi/update.ps1 -PiHost replay-arena-x
#   powershell -ExecutionPolicy Bypass -File edge/pi/update.ps1 -PiHost replay-arena-x -Full
#
# -Full também reenvia service/udev/install.sh e roda o install (pacotes, watchdog etc.).

param(
  [Parameter(Mandatory = $true)][string]$PiHost,
  [string]$User = "pi",
  [switch]$Full
)

$ErrorActionPreference = "Stop"
$edge = Split-Path -Parent $PSScriptRoot
$target = "$User@$PiHost"

& node --check (Join-Path $edge "agent.mjs")
if ($LASTEXITCODE -ne 0) { throw "agent.mjs com erro de sintaxe" }

if ($Full) {
  ssh $target "rm -rf /tmp/replay-edge && mkdir -p /tmp/replay-edge/pi"
  scp (Join-Path $edge "agent.mjs") "${target}:/tmp/replay-edge/agent.mjs"
  scp (Join-Path $PSScriptRoot "install.sh") (Join-Path $PSScriptRoot "replay-agent.service") `
    (Join-Path $PSScriptRoot "99-replay-button.rules") "${target}:/tmp/replay-edge/pi/"
  ssh $target "sed -i 's/\r$//' /tmp/replay-edge/pi/install.sh && sudo bash /tmp/replay-edge/pi/install.sh"
} else {
  scp (Join-Path $edge "agent.mjs") "${target}:/tmp/agent.mjs"
  ssh $target "sudo install -o root -g root -m 644 /tmp/agent.mjs /opt/replay/agent.mjs && sudo systemctl restart replay-agent && sleep 3 && systemctl is-active replay-agent && curl -s 127.0.0.1:8788/health"
}
if ($LASTEXITCODE -ne 0) { throw "falhou (exit $LASTEXITCODE)" }
