#!/usr/bin/env bash
# ============================================================
# Instalador del frontend Pi Stream en VPS pequeño
# Asume: VPS con Debian/Ubuntu, Node.js 20+ via nvm o apt
# Ejecutar como usuario no-root:
#   bash setup-vps.sh
# ============================================================
set -euo pipefail

LOG_GREEN='\033[0;32m'
LOG_BLUE='\033[0;34m'
LOG_RED='\033[0;31m'
LOG_RESET='\033[0m'

info()  { echo -e "${LOG_BLUE}[INFO]${LOG_RESET} $*"; }
ok()    { echo -e "${LOG_GREEN}[OK]${LOG_RESET} $*"; }
err()   { echo -e "${LOG_RED}[ERR]${LOG_RESET} $*" >&2; }

if [[ $EUID -eq 0 ]]; then
  err "No ejecutes como root. Crea un usuario 'deploy' o usa tu usuario."
  exit 1
fi

PROJECT_DIR="$HOME/pi-stream-frontend"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

# ------------------------------------------------------------
# 1. Dependencias del sistema
# ------------------------------------------------------------
info "Actualizando sistema e instalando dependencias…"
sudo apt-get update -qq
sudo apt-get install -y -qq \
  curl ca-certificates \
  build-essential \
  git

# Node.js 22 LTS via NodeSource si no está
if ! command -v node &>/dev/null || [[ "$(node -v | cut -dv -f2 | cut -d. -f1)" -lt 20 ]]; then
  info "Instalando Node.js 22 LTS…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi
ok "Node.js: $(node -v)"

# Caddy como reverse proxy (mejor que nginx para HTTPS automático)
if ! command -v caddy &>/dev/null; then
  info "Instalando Caddy (reverse proxy + HTTPS automático)…"
  sudo apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
  sudo apt-get update -qq
  sudo apt-get install -y -qq caddy
  ok "Caddy instalado"
else
  ok "Caddy ya está instalado: $(caddy version)"
fi

# ------------------------------------------------------------
# 2. Copiar proyecto frontend
# ------------------------------------------------------------
info "Copiando frontend a $PROJECT_DIR…"
mkdir -p "$PROJECT_DIR"

# Sincronizar src, public, package.json, configs
rsync -a --delete \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude 'dev.log' \
  --exclude '*.log' \
  "$REPO_DIR"/src \
  "$REPO_DIR"/public \
  "$REPO_DIR"/package.json \
  "$REPO_DIR"/bun.lock \
  "$REPO_DIR"/next.config.ts \
  "$REPO_DIR"/tsconfig.json \
  "$REPO_DIR"/tailwind.config.ts \
  "$REPO_DIR"/postcss.config.mjs \
  "$REPO_DIR"/components.json \
  "$REPO_DIR"/eslint.config.mjs \
  "$REPO_DIR"/prisma \
  "$PROJECT_DIR"/ 2>/dev/null || true

# Crear .env si no existe
if [[ ! -f "$PROJECT_DIR/.env" ]]; then
  info "Creando .env — EDITA los valores antes de continuar"
  cat > "$PROJECT_DIR/.env" <<EOF
# YouTube Data API v3 (https://console.cloud.google.com/)
YOUTUBE_API_KEY=

# URL pública del backend de la Pi (vía Cloudflare Tunnel)
PI_STREAM_BASE=https://stream.tudominio.com
EOF
  ok ".env creado en $PROJECT_DIR/.env"
  err "EDITA $PROJECT_DIR/.env con tu API key y dominio antes del build"
fi

cd "$PROJECT_DIR"

# ------------------------------------------------------------
# 3. Instalar dependencias
# ------------------------------------------------------------
info "Instalando dependencias con bun (más rápido que npm)…"
if ! command -v bun &>/dev/null; then
  info "Instalando bun…"
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi
bun install --frozen-lockfile 2>/dev/null || bun install
ok "Dependencias instaladas"

# ------------------------------------------------------------
# 4. Build de producción
# ------------------------------------------------------------
info "Construyendo build de producción…"
# Asegurarnos que next.config tiene output: 'standalone'
bun run build
ok "Build completo en .next/standalone"

# ------------------------------------------------------------
# 5. Configurar Caddy
# ------------------------------------------------------------
info "Configurando Caddy…"
read -r -p "Dominio del frontend (ej: app.tudominio.com): " DOMAIN
if [[ -z "$DOMAIN" ]]; then
  err "Dominio vacío. Edita /etc/caddy/Caddyfile manualmente."
else
  CADDYFILE="/etc/caddy/Caddyfile"
  sudo tee "$CADDYFILE" > /dev/null <<EOF
# Pi Stream Frontend
$DOMAIN {
    encode zstd gzip
    root * $PROJECT_DIR/.next/standalone
    handle /_next/static/* {
        uri strip_prefix /_next/static
        root * $PROJECT_DIR/.next/static
        file_server
    }
    handle {
        reverse_proxy 127.0.0.1:3000
    }
}

# Cache de thumbnails de YouTube (opcional, reduce requests a ytimg.com)
:8080 {
    @ytimg path /_ytimg/*
    handle @ytimg {
        uri strip_prefix /_ytimg
        reverse_proxy https://i.ytimg.com {
            header_up Host i.ytimg.com
        }
    }
}
EOF
  sudo systemctl reload caddy || sudo systemctl restart caddy
  ok "Caddy configurado para $DOMAIN (HTTPS automático)"
fi

# ------------------------------------------------------------
# 6. systemd service para Next.js
# ------------------------------------------------------------
info "Instalando servicio systemd para Next.js…"
USER_NAME=$(whoami)
USER_HOME="$HOME"
SERVICE_FILE="/tmp/pi-stream-frontend.service"
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Pi Stream Frontend (Next.js)
After=network.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$PROJECT_DIR
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1
ExecStart=$(which node) $PROJECT_DIR/.next/standalone/server.js
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
EOF

sudo mv "$SERVICE_FILE" /etc/systemd/system/pi-stream-frontend.service
sudo systemctl daemon-reload
sudo systemctl enable pi-stream-frontend
sudo systemctl restart pi-stream-frontend
sleep 3

if sudo systemctl is-active --quiet pi-stream-frontend; then
  ok "Servicio Next.js activo en http://127.0.0.1:3000"
else
  err "Servicio no arrancó:"
  sudo journalctl -u pi-stream-frontend -n 30 --no-pager
  exit 1
fi

# ------------------------------------------------------------
# 7. Verificar
# ------------------------------------------------------------
info "Verificando…"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000 || echo "000")
if [[ "$HTTP_CODE" =~ ^[23] ]]; then
  ok "Frontend responde localmente (HTTP $HTTP_CODE)"
else
  err "Frontend no responde (HTTP $HTTP_CODE)"
fi

echo ""
echo -e "${LOG_GREEN}========================================${LOG_RESET}"
echo -e "${LOG_GREEN}  FRONTEND INSTALADO EN VPS${LOG_RESET}"
echo -e "${LOG_GREEN}========================================${LOG_RESET}"
echo ""
echo "Próximos pasos:"
echo ""
echo "1. Edita $PROJECT_DIR/.env con tu YOUTUBE_API_KEY y PI_STREAM_BASE"
echo "2. Reinicia: sudo systemctl restart pi-stream-frontend"
echo "3. Verifica: curl https://$DOMAIN/"
echo ""
echo "4. Configura Cloudflare Tunnel para este VPS:"
echo "   - En Cloudflare Zero Trust → Tunnels → tu túnel del VPS"
echo "   - Public hostname: app.tudominio.com → http://localhost:80"
echo "   (Caddy escucha en :80 y :443 con HTTPS automático)"
echo ""
echo "Logs: sudo journalctl -u pi-stream-frontend -f"
