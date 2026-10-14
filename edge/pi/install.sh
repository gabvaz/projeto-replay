#!/usr/bin/env bash
# Instala o agente do replay num Raspberry Pi (Raspberry Pi OS Lite, bookworm).
#
# No Pi, com a pasta edge/ copiada:
#   sudo bash edge/pi/install.sh [--hostname replay-arena-x] [--tailscale-authkey tskey-...]
#
# Idempotente: rodar de novo atualiza o agente e os arquivos de sistema sem tocar no edge.env.
set -euo pipefail

NODE_MAJOR=22
HOSTNAME_ARG=""
TS_AUTHKEY="${TS_AUTHKEY:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hostname) HOSTNAME_ARG="$2"; shift 2 ;;
    --tailscale-authkey) TS_AUTHKEY="$2"; shift 2 ;;
    *) echo "argumento desconhecido: $1" >&2; exit 1 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "rode com sudo" >&2; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EDGE_DIR="$(dirname "$HERE")"
step() { echo -e "\n==> $*"; }

step "pacotes (ffmpeg, curl, xz)"
apt-get update -qq
apt-get install -y -qq ffmpeg curl xz-utils ca-certificates

step "node $NODE_MAJOR"
if ! command -v node >/dev/null || [[ "$(node -v)" != v${NODE_MAJOR}.* ]]; then
  case "$(uname -m)" in
    aarch64) ARCH=arm64 ;;
    armv7l) ARCH=armv7l ;;
    x86_64) ARCH=x64 ;;
    *) echo "arquitetura não suportada: $(uname -m)" >&2; exit 1 ;;
  esac
  BASE="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  FILE="$(curl -fsSL "$BASE/SHASUMS256.txt" | awk '{print $2}' | grep "linux-${ARCH}.tar.xz$")"
  TMP="$(mktemp -d)"
  curl -fsSL "$BASE/$FILE" -o "$TMP/$FILE"
  (cd "$TMP" && curl -fsSL "$BASE/SHASUMS256.txt" | grep " $FILE\$" | sha256sum -c -)
  tar -xJf "$TMP/$FILE" -C /usr/local --strip-components=1 --exclude CHANGELOG.md --exclude README.md --exclude LICENSE
  rm -rf "$TMP"
fi
node -v

step "usuário replay e pastas"
id replay >/dev/null 2>&1 || useradd --system --home /var/lib/replay --shell /usr/sbin/nologin replay
usermod -aG dialout,video replay
install -d -o replay -g replay -m 750 /var/lib/replay /var/lib/replay/outbox
install -d -o root -g root -m 755 /opt/replay
install -o root -g root -m 644 "$EDGE_DIR/agent.mjs" /opt/replay/agent.mjs

step "configuração /etc/replay/edge.env"
install -d -o root -g replay -m 750 /etc/replay
if [[ ! -f /etc/replay/edge.env ]]; then
  cat > /etc/replay/edge.env <<'EOF'
API_BASE=https://projeto-replay.gabrieltenoriovaz-10a.workers.dev
COURT_KEY=
EDGE_TOKEN=
RTSP_URL=
RTSP_TRANSPORT=tcp
CAMERA_ROTATION=0
PRE_ROLL_SEC=20
POST_ROLL_SEC=3
SEGMENT_SEC=2
COOLDOWN_SEC=5
HEARTBEAT_SEC=60
BUTTON_SERIAL=/dev/replay-button
OUTBOX_DIR=/var/lib/replay/outbox
OUTBOX_MAX_MB=200
EOF
  echo "criado — preencha COURT_KEY, EDGE_TOKEN e RTSP_URL"
fi
chown root:replay /etc/replay/edge.env
chmod 640 /etc/replay/edge.env

step "udev do botão (/dev/replay-button)"
install -o root -g root -m 644 "$HERE/99-replay-button.rules" /etc/udev/rules.d/99-replay-button.rules
udevadm control --reload-rules
udevadm trigger --subsystem-match=tty || true

step "journald limitado (SD)"
install -d /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/replay.conf <<'EOF'
[Journal]
SystemMaxUse=50M
EOF
systemctl restart systemd-journald

step "watchdog de hardware (Pi trava → reboot)"
BOOT_CONFIG=/boot/firmware/config.txt
[[ -f $BOOT_CONFIG ]] || BOOT_CONFIG=/boot/config.txt
if [[ -f $BOOT_CONFIG ]] && ! grep -q '^dtparam=watchdog=on' "$BOOT_CONFIG"; then
  echo "dtparam=watchdog=on" >> "$BOOT_CONFIG"
  NEEDS_REBOOT=1
fi
install -d /etc/systemd/system.conf.d
cat > /etc/systemd/system.conf.d/watchdog.conf <<'EOF'
[Manager]
RuntimeWatchdogSec=15
RebootWatchdogSec=2min
EOF
systemctl daemon-reexec

step "serviço replay-agent"
install -o root -g root -m 644 "$HERE/replay-agent.service" /etc/systemd/system/replay-agent.service
systemctl daemon-reload
systemctl enable replay-agent >/dev/null
if grep -qE '^(EDGE_TOKEN|COURT_KEY)=$' /etc/replay/edge.env; then
  echo "edge.env incompleto — serviço habilitado mas não iniciado"
else
  systemctl restart replay-agent
fi

step "tailscale (acesso remoto sem abrir porta)"
if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
TS_ARGS=(--ssh)
[[ -n "$HOSTNAME_ARG" ]] && TS_ARGS+=(--hostname "$HOSTNAME_ARG")
[[ -n "$TS_AUTHKEY" ]] && TS_ARGS+=(--authkey "$TS_AUTHKEY")
tailscale up "${TS_ARGS[@]}" || echo "tailscale up falhou — rode manualmente: sudo tailscale up --ssh"

step "pronto"
echo "logs:    journalctl -u replay-agent -f"
echo "config:  sudo nano /etc/replay/edge.env && sudo systemctl restart replay-agent"
echo "saúde:   curl -s 127.0.0.1:8788/health"
[[ "${NEEDS_REBOOT:-0}" == 1 ]] && echo "REINICIE o Pi pra ativar o watchdog de hardware (sudo reboot)"
exit 0
