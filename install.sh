#!/usr/bin/env bash
# ============================================================
# Pi Stream — Installer universal (Pi 5 o VPS)
#
# Uso (one-liner):
#   bash <(curl -fsSL https://raw.githubusercontent.com/SantiagortegaDev/harmonix-server/main/install.sh)
#
# O descargar y ejecutar:
#   curl -fsSL https://raw.githubusercontent.com/SantiagortegaDev/harmonix-server/main/install.sh -o install.sh
#   bash install.sh
#
# El script detecta automáticamente si está corriendo en:
#   - Raspberry Pi (ARM) → instala backend FastAPI + yt-dlp
#   - VPS x86_64        → instala frontend Next.js + Caddy
# ============================================================
set -euo pipefail

REPO_URL="https://github.com/SantiagortegaDev/harmonix-server"
REPO_RAW="https://raw.githubusercontent.com/SantiagortegaDev/harmonix-server/main"

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

# ------------------------------------------------------------
# Detección de plataforma
# ------------------------------------------------------------
detect_platform() {
  ARCH=$(uname -m)
  # Detectar Pi específicamente (ARM + algún modelo Pi en cpuinfo o device tree)
  if [[ "$ARCH" == "aarch64" || "$ARCH" == "armv7l" ]]; then
    if grep -q -i "raspberry\|bcm" /proc/cpuinfo 2>/dev/null || [[ -d /proc/device-tree ]]; then
      echo "pi"
    else
      # ARM pero no Pi — asumimos Pi de todos modos (es lo más probable en ARM)
      echo "pi"
    fi
  elif [[ "$ARCH" == "x86_64" || "$ARCH" == "amd64" ]]; then
    echo "vps"
  else
    echo "unknown"
  fi
}

# ------------------------------------------------------------
# Banner
# ------------------------------------------------------------
cat << 'BANNER'
  ╔═══════════════════════════════════════════════════════════╗
  ║                                                            ║
  ║   Pi Stream — Installer universal                          ║
  ║   YouTube Music streaming con Raspberry Pi + VPS           ║
  ║                                                            ║
  ╚═══════════════════════════════════════════════════════════╝
BANNER

echo ""
echo "Repo:  $REPO_URL"
echo "Host:  $(hostname)"
echo "User:  $(whoami)"
echo "Arch:  $(uname -m)"
echo "OS:    $(uname -srm)"
echo "Date:  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# ------------------------------------------------------------
# Verificar root
# ------------------------------------------------------------
if [[ $EUID -eq 0 ]]; then
  err "No ejecutes esto como root. Usa tu usuario normal."
  err "Si necesitas sudo, el script lo pedirá cuando toque."
  exit 1
fi

# Verificar sudo disponible
if ! sudo -v 2>/dev/null; then
  err "Necesitas privilegios sudo. Agrega tu usuario al grupo sudo:"
  err "  usermod -aG sudo $USER  (como root)"
  exit 1
fi

# ------------------------------------------------------------
# Detectar plataforma
# ------------------------------------------------------------
PLATFORM=$(detect_platform)

case "$PLATFORM" in
  pi)
    title "Raspberry Pi detectada — Instalando BACKEND"
    echo "Vas a instalar:"
    echo "  • Python 3 venv + FastAPI + uvicorn"
    echo "  • yt-dlp (última versión)"
    echo "  • ffmpeg"
    echo "  • SQLite cache (TTL 5h)"
    echo "  • systemd service (pi-stream.service)"
    echo ""
    echo "Cloudflare Tunnel debes instalarlo aparte (ver docs/CLOUDFLARE_TUNNEL.md)"
    echo ""
    read -r -p "¿Continuar? [y/N] " ans
    [[ "$ans" =~ ^[Yy] ]] || { echo "Cancelado."; exit 0; }
    title "Instalando backend…"

    # Descargar setup-pi.sh del repo y ejecutarlo
    info "Descargando setup-pi.sh…"
    TMPDIR=$(mktemp -d)
    curl -fsSL "$REPO_RAW/deploy/setup-pi.sh" -o "$TMPDIR/setup-pi.sh"
    # También necesitamos los archivos del backend
    info "Clonando repo…"
    git clone --depth 1 "$REPO_URL" "$TMPDIR/repo" 2>/dev/null || {
      # Fallback: descargar como tarball si git no está disponible
      info "git no disponible, descargando tarball…"
      sudo apt-get install -y -qq git >/dev/null
      git clone --depth 1 "$REPO_URL" "$TMPDIR/repo"
    }

    # Mover archivos a ~/pi-stream-src
    if [[ -d "$HOME/pi-stream-src" ]]; then
      warn "~/pi-stream-src existe, actualizando…"
      rm -rf "$HOME/pi-stream-src"
    fi
    mkdir -p "$HOME/pi-stream-src"
    cp -r "$TMPDIR/repo/pi-backend" "$HOME/pi-stream-src/"
    cp -r "$TMPDIR/repo/deploy" "$HOME/pi-stream-src/"

    cd "$HOME/pi-stream-src/deploy"
    bash setup-pi.sh

    rm -rf "$TMPDIR"
    ;;

  vps)
    title "VPS x86_64 detectado — Instalando FRONTEND"
    echo "Vas a instalar:"
    echo "  • Node.js 22 LTS + bun"
    echo "  • Next.js 16 build de producción"
    echo "  • Caddy (reverse proxy + HTTPS automático)"
    echo "  • systemd service (pi-stream-frontend.service)"
    echo ""
    echo "Cloudflare Tunnel debes instalarlo aparte (ver docs/CLOUDFLARE_TUNNEL.md)"
    echo ""
    echo "AVISO: necesitarás tu YouTube Data API key y el dominio de la Pi."
    echo ""
    read -r -p "¿Continuar? [y/N] " ans
    [[ "$ans" =~ ^[Yy] ]] || { echo "Cancelado."; exit 0; }
    title "Instalando frontend…"

    # Clonar repo a ~/pi-stream-repo
    if [[ ! -d "$HOME/pi-stream-repo" ]]; then
      info "Clonando repo…"
      sudo apt-get install -y -qq git >/dev/null 2>&1 || true
      git clone --depth 1 "$REPO_URL" "$HOME/pi-stream-repo"
    else
      info "Repo existe, actualizando…"
      cd "$HOME/pi-stream-repo" && git pull --ff-only
    fi

    cd "$HOME/pi-stream-repo"
    bash deploy/setup-vps.sh
    ;;

  *)
    err "Plataforma no soportada: $ARCH"
    err "Este script funciona en:"
    err "  - Raspberry Pi (ARM64/ARMv7)"
    err "  - VPS x86_64 (amd64)"
    exit 1
    ;;
esac

# ------------------------------------------------------------
# Final
# ------------------------------------------------------------
echo ""
echo -e "${LOG_GREEN}========================================${LOG_RESET}"
echo -e "${LOG_GREEN}  INSTALACIÓN COMPLETADA${LOG_RESET}"
echo -e "${LOG_GREEN}========================================${LOG_RESET}"
echo ""
echo "Próximos pasos:"
echo ""
if [[ "$PLATFORM" == "pi" ]]; then
  echo "  1. Instala Cloudflare Tunnel en esta Pi:"
  echo "     curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -o /tmp/cf.deb"
  echo "     sudo dpkg -i /tmp/cf.deb"
  echo "     sudo cloudflared service install <TU_TOKEN_PI_TUNNEL>"
  echo ""
  echo "  2. En el dashboard de Cloudflare Zero Trust:"
  echo "     stream.tudominio.com → http://localhost:8000"
  echo ""
  echo "  3. Verifica: curl https://stream.tudominio.com/health"
else
  echo "  1. Edita ~/pi-stream-frontend/.env con tu YOUTUBE_API_KEY y PI_STREAM_BASE"
  echo ""
  echo "  2. Reinicia: sudo systemctl restart pi-stream-frontend"
  echo ""
  echo "  3. Instala Cloudflare Tunnel en este VPS:"
  echo "     curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cf.deb"
  echo "     sudo dpkg -i /tmp/cf.deb"
  echo "     sudo cloudflared service install <TU_TOKEN_VPS_TUNNEL>"
  echo ""
  echo "  4. En el dashboard de Cloudflare Zero Trust:"
  echo "     app.tudominio.com → http://localhost:80"
  echo ""
  echo "  5. Verifica: curl https://app.tudominio.com/"
fi
echo ""
echo "Documentación completa: $REPO_URL#readme"
echo ""
