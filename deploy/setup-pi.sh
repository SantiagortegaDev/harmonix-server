#!/usr/bin/env bash
# ============================================================
# Pi Stream — Instalador BACKEND para Raspberry Pi 5
#
# Uso (one-liner):
#   bash <(curl -fsSL https://raw.githubusercontent.com/SantiagortegaDev/harmonix-server/main/deploy/setup-pi.sh)
#
# O descargar y ejecutar:
#   curl -fsSL https://raw.githubusercontent.com/SantiagortegaDev/harmonix-server/main/deploy/setup-pi.sh -o setup-pi.sh
#   bash setup-pi.sh
#
# Qué instala:
#   • Python 3 venv + FastAPI + uvicorn
#   • yt-dlp (última versión)
#   • ffmpeg
#   • SQLite cache (TTL 5h)
#   • systemd service (pi-stream.service)
#   • SOPORTE OPCIONAL DE COOKIES.TXT para yt-dlp
#     (soluciona errores "Sign in to confirm you're not a bot")
# ============================================================
set -euo pipefail

LOG_GREEN='\033[0;32m'
LOG_BLUE='\033[0;34m'
LOG_YELLOW='\033[0;33m'
LOG_RED='\033[0;31m'
LOG_CYAN='\033[0;36m'
LOG_RESET='\033[0m'
LOG_BOLD='\033[1m'

info()  { echo -e "${LOG_BLUE}[INFO]${LOG_RESET} $*"; }
ok()    { echo -e "${LOG_GREEN}[OK]${LOG_RESET} $*"; }
warn()  { echo -e "${LOG_YELLOW}[WARN]${LOG_RESET} $*"; }
err()   { echo -e "${LOG_RED}[ERR]${LOG_RESET} $*" >&2; }
title() { echo -e "\n${LOG_CYAN}${LOG_BOLD}=== $* ===${LOG_RESET}\n"; }

cat << 'BANNER'
  ╔═══════════════════════════════════════════════════════════╗
  ║                                                            ║
  ║   Pi Stream — Backend Installer (Raspberry Pi 5)           ║
  ║   YouTube Music streaming con cache + yt-dlp               ║
  ║                                                            ║
  ╚═══════════════════════════════════════════════════════════╝
BANNER

echo "Host: $(hostname)"
echo "User: $(whoami)"
echo "Arch: $(uname -m)"
echo ""

# ------------------------------------------------------------
# Verificar root
# ------------------------------------------------------------
if [[ $EUID -eq 0 ]]; then
  err "No ejecutes esto como root. Usa tu usuario 'pi' normal."
  exit 1
fi

if ! sudo -v 2>/dev/null; then
  err "Necesitas privilegios sudo."
  err "Ejecuta como usuario 'pi' (que tiene sudo por defecto en Raspberry Pi OS)."
  exit 1
fi

# Verificar que es ARM (Raspberry Pi)
ARCH=$(uname -m)
if [[ ! "$ARCH" =~ ^arm|^aarch ]]; then
  warn "Arquitectura inesperada: $ARCH (esperaba ARM)"
  warn "Esto está pensado para Raspberry Pi. ¿Continuar?"
  read -r -p "[y/N] " ans
  [[ "$ans" =~ ^[Yy] ]] || exit 0
fi

PROJECT_DIR="$HOME/pi-stream"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Detectar si tenemos el repo clonado o venimos de curl directo
REPO_DIR=""
if [[ -f "$SCRIPT_DIR/../pi-backend/main.py" ]]; then
  REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
  info "Repo local detectado: $REPO_DIR"
elif [[ -f "$SCRIPT_DIR/pi-backend/main.py" ]]; then
  REPO_DIR="$SCRIPT_DIR"
  info "Repo local detectado: $REPO_DIR"
fi

# ------------------------------------------------------------
# 1. Dependencias del sistema
# ------------------------------------------------------------
title "1. Instalando dependencias del sistema"

info "Actualizando apt e instalando paquetes…"
sudo apt-get update -qq
sudo apt-get install -y -qq \
  python3 python3-venv python3-pip \
  ffmpeg \
  curl wget \
  sqlite3 \
  ca-certificates \
  git

ok "Dependencias del sistema instaladas"

# ------------------------------------------------------------
# 2. Directorio del proyecto
# ------------------------------------------------------------
title "2. Preparando directorio del proyecto"

if [[ -n "$REPO_DIR" ]]; then
  # Tenemos repo local, copiar a ~/pi-stream
  if [[ "$REPO_DIR" != "$PROJECT_DIR" ]]; then
    info "Copiando archivos del backend a $PROJECT_DIR…"
    mkdir -p "$PROJECT_DIR"
    cp -r "$REPO_DIR/pi-backend/." "$PROJECT_DIR/"
    if [[ -d "$REPO_DIR/deploy" ]]; then
      cp -r "$REPO_DIR/deploy" "$PROJECT_DIR/"
    fi
  else
    info "Ya en $PROJECT_DIR"
  fi
else
  # Curl directo, clonar el repo
  if [[ ! -d "$PROJECT_DIR" ]]; then
    info "Clonando repo de GitHub…"
    git clone --depth 1 https://github.com/SantiagortegaDev/harmonix-server /tmp/harmonix-src
    mkdir -p "$PROJECT_DIR"
    cp -r /tmp/harmonix-src/pi-backend/. "$PROJECT_DIR/"
    cp -r /tmp/harmonix-src/deploy "$PROJECT_DIR/"
    rm -rf /tmp/harmonix-src
  else
    info "$PROJECT_DIR ya existe, actualizando archivos…"
    git clone --depth 1 https://github.com/SantiagortegaDev/harmonix-server /tmp/harmonix-src
    cp -r /tmp/harmonix-src/pi-backend/main.py "$PROJECT_DIR/"
    cp -r /tmp/harmonix-src/pi-backend/requirements.txt "$PROJECT_DIR/"
    cp -r /tmp/harmonix-src/pi-backend/.env.example "$PROJECT_DIR/"
    rm -rf /tmp/harmonix-src
  fi
fi

cd "$PROJECT_DIR"

# ------------------------------------------------------------
# 3. Crear .env si no existe
# ------------------------------------------------------------
if [[ ! -f .env ]]; then
  info "Creando .env desde .env.example…"
  cp .env.example .env
  ok ".env creado"
fi

# ------------------------------------------------------------
# 4. Entorno virtual Python
# ------------------------------------------------------------
title "3. Configurando entorno Python"

if [[ ! -d venv ]]; then
  info "Creando entorno virtual…"
  python3 -m venv venv
fi

source venv/bin/activate

info "Instalando dependencias Python…"
pip install --upgrade pip --quiet
pip install -r requirements.txt --quiet
ok "Dependencias Python instaladas"

# yt-dlp se actualiza seguido, asegurar última versión
info "Actualizando yt-dlp a la última versión…"
pip install --upgrade yt-dlp --quiet
ok "yt-dlp actualizado a $(yt-dlp --version)"

# ------------------------------------------------------------
# 5. COOKIES.TXT — opcional pero recomendado
# ------------------------------------------------------------
title "4. Configuración de cookies.txt (OPCIONAL)"

echo "Las cookies de YouTube resuelven errores como:"
echo "  • \"Sign in to confirm you're not a bot\""
echo "  • \"Unable to extract video data\""
echo "  • Age-restricted videos"
echo "  • Rate limits más agresivos de lo normal"
echo ""
echo "Sin cookies igual funciona, pero con cookies es más robusto."
echo ""
echo "Para obtener cookies.txt:"
echo "  1. Instala la extensión 'Get cookies.txt LOCALLY'"
echo "     en tu navegador (Chrome o Firefox)"
echo "  2. Inicia sesión en youtube.com con una cuenta secundaria"
echo "     (NO uses tu cuenta principal por si la banean)"
echo "  3. Abre la extensión y exporta como cookies.txt"
echo "  4. Copia el archivo a la Pi:"
echo "       scp cookies.txt pi@tu-pi:~/pi-stream/cookies.txt"
echo "  5. Vuelve a correr este script o reinicia el servicio"
echo ""

read -r -p "¿Tienes cookies.txt para configurar AHORA? [y/N] " ans
if [[ "$ans" =~ ^[Yy] ]]; then
  if [[ -f cookies.txt ]]; then
    info "cookies.txt ya existe en $PROJECT_DIR/cookies.txt"
    read -r -p "¿Sobrescribir? [y/N] " ans2
    if [[ "$ans2" =~ ^[Yy] ]]; then
      info "Pega el contenido del cookies.txt. Ctrl+D para terminar."
      cat > cookies.txt
      ok "cookies.txt sobrescrito"
    else
      info "Manteniendo cookies.txt existente"
    fi
  else
    info "Pega el contenido del cookies.txt. Ctrl+D para terminar."
    cat > cookies.txt
    if [[ -s cookies.txt ]]; then
      ok "cookies.txt creado"
    else
      warn "cookies.txt vacío, se ignora"
      rm -f cookies.txt
    fi
  fi
else
  info "Saltando cookies.txt. Puedes añadirlo más tarde:"
  info "  scp cookies.txt pi@tu-pi:~/pi-stream/cookies.txt"
  info "  sudo systemctl restart pi-stream"
fi

# Validar formato del cookies.txt si existe
if [[ -f cookies.txt ]]; then
  if grep -q "^# Netscape HTTP Cookie File" cookies.txt || \
     grep -q "youtube.com" cookies.txt; then
    ok "Formato cookies.txt parece válido (Netscape format)"
    # Activar en .env
    if ! grep -q "^USE_COOKIES=" .env; then
      echo "USE_COOKIES=true" >> .env
    else
      sed -i 's/^USE_COOKIES=.*/USE_COOKIES=true/' .env
    fi
    ok "USE_COOKIES=true activado en .env"
  else
    warn "cookies.txt no parece tener formato Netscape correcto"
    warn "Debe empezar con '# Netscape HTTP Cookie File' y tener filas de youtube.com"
    warn "Continuando sin activar cookies — revisa el archivo manualmente"
    sed -i 's/^USE_COOKIES=.*/USE_COOKIES=false/' .env 2>/dev/null || \
      echo "USE_COOKIES=false" >> .env
  fi
else
  # Sin cookies, asegurar que USE_COOKIES=false
  if ! grep -q "^USE_COOKIES=" .env; then
    echo "USE_COOKIES=false" >> .env
  else
    sed -i 's/^USE_COOKIES=.*/USE_COOKIES=false/' .env
  fi
fi

# ------------------------------------------------------------
# 6. Probar yt-dlp
# ------------------------------------------------------------
title "5. Probando yt-dlp"

COOKIES_ARG=""
if [[ -f cookies.txt ]] && grep -q "^USE_COOKIES=true" .env; then
  COOKIES_ARG="--cookies cookies.txt"
  info "Probando CON cookies…"
else
  info "Probando SIN cookies…"
fi

YTDLP_TEST=$(venv/bin/yt-dlp -g -f bestaudio/best --no-warnings \
  $COOKIES_ARG \
  --extractor-args "youtube:player_client=tv,android_vr,android,web" \
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ" 2>&1 || true)

if [[ "$YTDLP_TEST" =~ ^https:// ]]; then
  ok "yt-dlp funciona correctamente"
else
  warn "yt-dlp NO devolvió una URL válida:"
  echo "$YTDLP_TEST" | head -10
  warn "Posibles causas:"
  warn "  • Sin cookies: YouTube puede pedir verificación (instala cookies.txt)"
  warn "  • IP bajo sospecha temporal (espera 1h y reintenta)"
  warn "  • Versión vieja de yt-dlp (ya actualizada arriba)"
  warn ""
  warn "Continuando igualmente — el backend caerá en cache cuando funcione"
fi

# ------------------------------------------------------------
# 7. Inicializar DB
# ------------------------------------------------------------
title "6. Inicializando base de datos"

python3 -c "from main import init_db; init_db()"
ok "DB inicializada en $PROJECT_DIR/cache.db"

# ------------------------------------------------------------
# 8. Instalar systemd service
# ------------------------------------------------------------
title "7. Instalando servicio systemd"

# Ajustar el service file si el usuario no es 'pi'
USER_NAME=$(whoami)
USER_HOME="$HOME"
SERVICE_SRC="$PROJECT_DIR/pi-stream.service"
if [[ -f "$SERVICE_SRC" ]]; then
  if [[ "$USER_NAME" != "pi" ]]; then
    sed -i "s|User=pi|User=$USER_NAME|g" "$SERVICE_SRC"
    sed -i "s|/home/pi/pi-stream|$USER_HOME/pi-stream|g" "$SERVICE_SRC"
  fi
  # Asegurar que carga el .env
  if ! grep -q "EnvironmentFile" "$SERVICE_SRC"; then
    sed -i "/^ExecStart=/i EnvironmentFile=$USER_HOME/pi-stream/.env" "$SERVICE_SRC"
  fi
else
  warn "pi-stream.service no encontrado, creando uno por defecto…"
  cat > "$SERVICE_SRC" <<EOF
[Unit]
Description=Pi Stream Backend (FastAPI + yt-dlp)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$USER_HOME/pi-stream
EnvironmentFile=$USER_HOME/pi-stream/.env
ExecStart=$USER_HOME/pi-stream/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1
Restart=on-failure
RestartSec=5s
StandardOutput=append:$USER_HOME/pi-stream/stream.log
StandardError=append:$USER_HOME/pi-stream/stream.log

# Seguridad
NoNewPrivileges=yes
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=$USER_HOME/pi-stream
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF
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
# 9. Probar endpoint local
# ------------------------------------------------------------
title "8. Verificando backend"

sleep 1
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/health || echo "000")
if [[ "$HEALTH" == "200" ]]; then
  ok "Backend responde en http://127.0.0.1:8000/health"
  curl -s http://127.0.0.1:8000/health | python3 -m json.tool 2>/dev/null || true
else
  err "Backend no responde (código $HEALTH)"
  err "Revisa: sudo journalctl -u pi-stream -f"
fi

# ------------------------------------------------------------
# 10. Cron para auto-actualizar yt-dlp
# ------------------------------------------------------------
title "9. Configurando auto-update de yt-dlp"

CRON_LINE="0 4 * * 1 $PROJECT_DIR/venv/bin/pip install --upgrade yt-dlp --quiet && /usr/bin/sudo /bin/systemctl restart pi-stream >> $PROJECT_DIR/stream.log 2>&1"

if crontab -l 2>/dev/null | grep -q "yt-dlp"; then
  info "Cron de yt-dlp ya existe, actualizando…"
  (crontab -l 2>/dev/null | grep -v "yt-dlp"; echo "$CRON_LINE") | crontab -
else
  info "Añadiendo cron semanal (lunes 04:00)…"
  (crontab -l 2>/dev/null 2>/dev/null; echo "$CRON_LINE") | crontab -
fi
ok "yt-dlp se actualizará automáticamente cada lunes a las 04:00"

# ------------------------------------------------------------
# 11. Resumen final
# ------------------------------------------------------------
echo ""
echo -e "${LOG_GREEN}========================================${LOG_RESET}"
echo -e "${LOG_GREEN}  BACKEND INSTALADO CORRECTAMENTE${LOG_RESET}"
echo -e "${LOG_GREEN}========================================${LOG_RESET}"
echo ""
echo "📁 Directorio: $PROJECT_DIR"
echo "🐍 Python venv: $PROJECT_DIR/venv"
echo "💾 Cache DB: $PROJECT_DIR/cache.db"
echo "📝 Logs: $PROJECT_DIR/stream.log"
echo "🍪 Cookies: $([[ -f $PROJECT_DIR/cookies.txt ]] && echo 'activas ✓' || echo 'no configuradas')"
echo ""

if [[ -f cookies.txt ]]; then
  echo "🍪 Para actualizar cookies más tarde:"
  echo "   scp cookies.txt pi@tu-pi:~/pi-stream/cookies.txt"
  echo "   sudo systemctl restart pi-stream"
  echo ""
fi

echo "📡 Próximos pasos:"
echo ""
echo "  1. Instala Cloudflare Tunnel en esta Pi:"
echo "     curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -o /tmp/cf.deb"
echo "     sudo dpkg -i /tmp/cf.deb"
echo "     sudo cloudflared service install <TOKEN_DE_PI_TUNNEL>"
echo ""
echo "  2. En Cloudflare Zero Trust → Tunnels → tu túnel:"
echo "     stream.tudominio.com → http://localhost:8000"
echo ""
echo "  3. Verifica desde fuera: curl https://stream.tudominio.com/health"
echo ""
echo "  4. Deploy del frontend en Vercel (ver docs/VERCEL_DEPLOY.md):"
echo "     https://vercel.com/new → importa SantiagortegaDev/harmonix-server"
echo ""
echo "Logs en vivo:    sudo journalctl -u pi-stream -f"
echo "Restart servicio: sudo systemctl restart pi-stream"
echo "Status:           sudo systemctl status pi-stream"
