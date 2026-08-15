#!/usr/bin/env bash
# ============================================================
# Instalador del backend Pi Stream en Raspberry Pi 5
# Ejecutar en la Pi como usuario 'pi':
#   bash setup-pi.sh
# ============================================================
set -euo pipefail

LOG_GREEN='\033[0;32m'
LOG_BLUE='\033[0;34m'
LOG_RED='\033[0;31m'
LOG_RESET='\033[0m'

info()  { echo -e "${LOG_BLUE}[INFO]${LOG_RESET} $*"; }
ok()    { echo -e "${LOG_GREEN}[OK]${LOG_RESET} $*"; }
err()   { echo -e "${LOG_RED}[ERR]${LOG_RESET} $*" >&2; }

# Verificar que somos pi (o usuario no-root)
if [[ $EUID -eq 0 ]]; then
  err "No ejecutes esto como root. Usa tu usuario 'pi' normal."
  exit 1
fi

# Verificar que es ARM (Raspberry Pi)
ARCH=$(uname -m)
info "Arquitectura detectada: $ARCH"
if [[ ! "$ARCH" =~ ^arm|^aarch ]]; then
  err "Este script es para Raspberry Pi (ARM). Estás en $ARCH."
  exit 1
fi

PROJECT_DIR="$HOME/pi-stream"
info "Directorio del proyecto: $PROJECT_DIR"

# ------------------------------------------------------------
# 1. Dependencias del sistema
# ------------------------------------------------------------
info "Actualizando sistema e instalando dependencias…"
sudo apt-get update -qq
sudo apt-get install -y -qq \
  python3 python3-venv python3-pip \
  ffmpeg \
  curl wget \
  sqlite3 \
  ca-certificates

ok "Dependencias del sistema instaladas"

# ------------------------------------------------------------
# 2. Crear directorio del proyecto
# ------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -d "$PROJECT_DIR" ]]; then
  mkdir -p "$PROJECT_DIR"
  info "Copiando archivos del backend a $PROJECT_DIR…"
  cp -r "$SCRIPT_DIR"/. "$PROJECT_DIR/"
else
  info "Directorio existe, sincronizando archivos…"
  cp -r "$SCRIPT_DIR"/main.py "$PROJECT_DIR/"
  cp -r "$SCRIPT_DIR"/requirements.txt "$PROJECT_DIR/"
  cp -r "$SCRIPT_DIR"/.env.example "$PROJECT_DIR/"
fi

cd "$PROJECT_DIR"

# ------------------------------------------------------------
# 3. Crear .env si no existe
# ------------------------------------------------------------
if [[ ! -f .env ]]; then
  info "Creando .env desde .env.example…"
  cp .env.example .env
  ok ".env creado (edítalo si quieres cambiar defaults)"
fi

# ------------------------------------------------------------
# 4. Entorno virtual Python
# ------------------------------------------------------------
info "Creando entorno virtual Python…"
python3 -m venv venv
source venv/bin/activate

info "Instalando dependencias Python…"
pip install --upgrade pip --quiet
pip install -r requirements.txt --quiet

ok "Dependencias Python instaladas"

# yt-dlp se actualiza seguido, asegurar última versión
info "Actualizando yt-dlp a la última versión…"
pip install --upgrade yt-dlp --quiet
ok "yt-dlp actualizado"

# ------------------------------------------------------------
# 5. Probar yt-dlp
# ------------------------------------------------------------
info "Probando yt-dlp con video corto…"
YTDLP_TEST=$(venv/bin/yt-dlp -g -f bestaudio --no-warnings \
  --extractor-args "youtube:player_client=mweb" \
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ" 2>&1 || true)

if [[ "$YTDLP_TEST" =~ ^https:// ]]; then
  ok "yt-dlp funciona correctamente (URL obtenida)"
else
  err "yt-dlp NO devolvió una URL válida:"
  echo "$YTDLP_TEST" | head -10
  err "Posibles causas: IP bajo sospecha, falta de red, o versión vieja."
  err "Continuando igualmente — prueba manualmente más tarde."
fi

# ------------------------------------------------------------
# 6. Inicializar DB
# ------------------------------------------------------------
info "Inicializando base de datos SQLite…"
python3 -c "from main import init_db; init_db()"
ok "DB inicializada en $PROJECT_DIR/cache.db"

# ------------------------------------------------------------
# 7. Instalar systemd service
# ------------------------------------------------------------
info "Instalando servicio systemd…"
SERVICE_SRC="$PROJECT_DIR/pi-stream.service"
# Ajustar rutas en el service file si el usuario no es 'pi'
USER_NAME=$(whoami)
USER_HOME="$HOME"
if [[ "$USER_NAME" != "pi" ]]; then
  sed -i "s|User=pi|User=$USER_NAME|g" "$SERVICE_SRC"
  sed -i "s|/home/pi/pi-stream|$USER_HOME/pi-stream|g" "$SERVICE_SRC"
fi

sudo cp "$SERVICE_SRC" /etc/systemd/system/pi-stream.service
sudo systemctl daemon-reload
sudo systemctl enable pi-stream
sudo systemctl restart pi-stream
sleep 2

if sudo systemctl is-active --quiet pi-stream; then
  ok "Servicio pi-stream activo y habilitado en boot"
else
  err "El servicio no arrancó. Logs:"
  sudo journalctl -u pi-stream -n 30 --no-pager
  exit 1
fi

# ------------------------------------------------------------
# 8. Probar endpoint local
# ------------------------------------------------------------
info "Probando endpoint /health…"
sleep 1
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/health || echo "000")
if [[ "$HEALTH" == "200" ]]; then
  ok "Backend responde en http://127.0.0.1:8000/health"
else
  err "Backend no responde (código $HEALTH). Revisa: sudo journalctl -u pi-stream -f"
fi

# ------------------------------------------------------------
# 9. Recordatorio de Cloudflare Tunnel
# ------------------------------------------------------------
echo ""
echo -e "${LOG_GREEN}========================================${LOG_RESET}"
echo -e "${LOG_GREEN}  BACKEND INSTALADO CORRECTAMENTE${LOG_RESET}"
echo -e "${LOG_GREEN}========================================${LOG_RESET}"
echo ""
echo "Próximos pasos:"
echo ""
echo "1. Instala Cloudflare Tunnel en la Pi:"
echo "   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -o /tmp/cf.deb"
echo "   sudo dpkg -i /tmp/cf.deb"
echo "   sudo cloudflared service install <TOKEN_DE_TUNNEL>"
echo ""
echo "2. En el dashboard de Cloudflare Zero Trust → Tunnels → tu túnel:"
echo "   - Crea un public hostname: stream.tudominio.com → http://localhost:8000"
echo ""
echo "3. Verifica desde fuera: curl https://stream.tudominio.com/health"
echo ""
echo "Logs: sudo journalctl -u pi-stream -f"
echo "DB:   sqlite3 $PROJECT_DIR/cache.db 'SELECT COUNT(*) FROM stream_cache;'"
