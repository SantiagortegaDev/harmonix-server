# Pi Stream — YouTube Music Streaming con Raspberry Pi 5

Streaming ultra-rápido de YouTube Music con arquitectura anti-ban: la Pi 5 (IP residencial) extrae las URLs firmadas con `yt-dlp`, las cachea en SQLite con TTL 5h, y hace passthrough hacia los clientes. El frontend Next.js se sirve desde **Vercel** (CDN global gratis) y solo maneja búsqueda y UI.

```
Usuario → app.tudominio.com (Vercel CDN) → YouTube Data API v3 (búsqueda)
         ↓ click en canción
         stream.tudominio.com (Pi 5 vía Cloudflare Tunnel)
         ↓
         Cache SQLite → hit? → passthrough a googlevideo
                       miss? → yt-dlp -g → cache → passthrough
```

**Latencia objetivo**: <3s desde click hasta audio sonando (cache hit <50ms, primer play 1.5-2s).

---

## 🚀 Instalación con una sola línea

### Backend en la Raspberry Pi 5

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/SantiagortegaDev/harmonix-server/main/deploy/setup-pi.sh)
```

Instala: Python venv, FastAPI, yt-dlp, ffmpeg, SQLite, systemd service.
**Te pedirá pegar el `cookies.txt`** (opcional pero recomendado para evitar bans).

### Frontend en Vercel

1. Ve a [vercel.com/new](https://vercel.com/new)
2. Importa el repo `SantiagortegaDev/harmonix-server`
3. Añade las variables de entorno (ver [`docs/VERCEL_DEPLOY.md`](docs/VERCEL_DEPLOY.md))
4. Deploy ✅

---

## 🍪 Cookies.txt (anti-ban)

El script de instalación te pedirá pegar el contenido de `cookies.txt`. Esto resuelve errores comunes de yt-dlp como:

- `Sign in to confirm you're not a bot`
- `Unable to extract video data`
- Videos con restricción de edad
- Rate limits agresivos

### Cómo obtener cookies.txt

1. Instala la extensión **"Get cookies.txt LOCALLY"** en Chrome o Firefox
2. Inicia sesión en youtube.com con una **cuenta secundaria** (no tu principal, por si la banean)
3. Abre la extensión y exporta como `cookies.txt`
4. Durante el install te pedirá pegar el contenido, o puedes subirlo después:
   ```bash
   scp cookies.txt pi@tu-pi:~/pi-stream/cookies.txt
   ssh pi@tu-pi "sudo systemctl restart pi-stream"
   ```

> ℹ️ Las cookies **NO se suben a GitHub** — están en `.gitignore` y solo viven en la Pi.

---

## 🔄 Deployment automático con GitHub Actions

Workflows en `.github/workflows/`:

| Workflow | Trigger | Qué hace |
|----------|---------|----------|
| `ci.yml` | push/PR a main | Lint + build check (no deploya) |
| `deploy-pi.yml` | push a main (cambios en `pi-backend/`) | SSH a Pi, `git pull`, restart systemd |
| `deploy-vercel.yml` | push a main (cambios en `src/`) | Verifica build; Vercel auto-deploya |
| `update-yt-dlp.yml` | cron semanal (lunes 04:00 UTC) | Actualiza yt-dlp en la Pi + smoke test + rollback si falla |

### Setup de secrets (5 minutos)

1. **Genera SSH key dedicada** para la Pi:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/harmonix_pi -N ""
   ssh-copy-id -i ~/.ssh/harmonix_pi.pub pi@tu-pi
   ```

2. **Añade estos secrets** en `Settings → Secrets and variables → Actions`:
   - `PI_HOST` — dominio o IP de la Pi (ej: `stream.tudominio.com`)
   - `PI_USER` — usuario SSH (`pi`)
   - `PI_SSH_KEY` — contenido de `~/.ssh/harmonix_pi` (privada)
   - `PI_SSH_PORT` — `22` (o el que tengas)
   - `MAIN_DOMAIN` — `tudominio.com` (sin subdominio)

3. **Push a main** y se deploya solo:
   ```bash
   git push origin main
   # → ci.yml corre
   # → deploy-pi.yml actualiza la Pi (si cambiaron archivos de backend)
   # → Vercel auto-deploya el frontend (si cambiaron archivos de frontend)
   ```

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│  Cloudflare (DNS + 1 Tunnel)                                    │
│  app.tudominio.com    → Vercel (CNAME, grey-cloud)              │
│  stream.tudominio.com → Pi 5 (Cloudflare Tunnel)                │
└─────────────────────────────────────────────────────────────────┘
         │                                       │
         ▼                                       ▼
┌────────────────────────┐         ┌──────────────────────────────┐
│  Vercel (gratis)        │         │  Raspberry Pi 5               │
│  - Next.js 16 (CDN)     │         │  - FastAPI + uvicorn          │
│  - API key YouTube      │         │  - yt-dlp + ffmpeg            │
│  - HTTPS automático     │         │  - SQLite cache (5h TTL)      │
│  - Deploy con git push  │         │  - Cookies.txt opcional       │
│  - NO toca YouTube      │         │  - Passthrough HTTP proxy     │
│    con yt-dlp           │         │  - IP residencial casera      │
└────────────────────────┘         └──────────────────────────────┘
                                              │
                                              ▼
                                   ┌──────────────────────────────┐
                                   │  YouTube / googlevideo.com    │
                                   │  (solo la Pi habla con esto)  │
                                   └──────────────────────────────┘
```

**Por qué esta arquitectura evita bans de YouTube:**
- YouTube bloquea IPs de datacenter por reputación antes de mirar cookies/UA
- Vercel sirve estáticos desde CDN — nunca toca YouTube
- La Pi tiene IP residencial del ISP → YouTube la trata como usuario normal
- Cache de 5h → si 100 personas escuchan la misma canción, solo 1 extracción
- `yt-dlp --sleep-requests 1` + rate limit 250 extracciones/hora (límite YT: 300)
- Cookies.txt opcional → resuelve "Sign in to confirm you're not a bot"
- Reverse-proxy preserva IP de la Pi hacia googlevideo (la URL está firmada para esa IP)

---

## Estructura del proyecto

```
harmonix-server/
├── src/                          # Frontend Next.js 16 (deploya en Vercel)
│   ├── app/
│   │   ├── layout.tsx            # Layout + ThemeProvider (MD3)
│   │   ├── page.tsx              # UI principal: búsqueda + player
│   │   ├── globals.css           # Material Design 3 tokens
│   │   └── api/
│   │       ├── search/route.ts   # Proxy a YouTube Data API v3
│   │       └── resolve/route.ts  # Devuelve URL del stream (Pi)
│   └── components/
│       └── theme-provider.tsx    # Wrapper next-themes
│
├── pi-backend/                   # Backend FastAPI (corre en la Pi)
│   ├── main.py                   # App FastAPI: cache + yt-dlp + passthrough + cookies
│   ├── requirements.txt          # fastapi, uvicorn, httpx, yt-dlp
│   ├── pi-stream.service         # systemd unit file
│   └── .env.example              # incluye USE_COOKIES
│
├── deploy/
│   └── setup-pi.sh               # Instalador automático backend en Pi
│
├── .github/workflows/            # CI/CD
│   ├── ci.yml
│   ├── deploy-pi.yml             # SSH deploy a Pi
│   ├── deploy-vercel.yml         # Verifica build antes de Vercel auto-deploy
│   └── update-yt-dlp.yml         # Cron semanal
│
├── docs/
│   ├── VERCEL_DEPLOY.md          # Guía detallada Vercel
│   ├── CLOUDFLARE_TUNNEL.md      # Guía Cloudflare Tunnel
│   └── DEPLOYMENT_OPTIONS.md     # Opciones alternativas de CI/CD
│
└── .env.example                  # Variables del frontend
```

---

## Quick start (15 minutos)

### Prerrequisitos

- [ ] Raspberry Pi 5 con Raspberry Pi OS + conexión casera a internet
- [ ] Cuenta de Vercel (gratis, login con GitHub)
- [ ] Dominio en Cloudflare
- [ ] YouTube Data API key
- [ ] Token de Cloudflare Tunnel (Zero Trust → Tunnels)
- [ ] (Recomendado) cookies.txt de YouTube

### 1. Instalar backend en la Pi

```bash
# En la Pi
bash <(curl -fsSL https://raw.githubusercontent.com/SantiagortegaDev/harmonix-server/main/deploy/setup-pi.sh)
# Te pedirá: confirmar, pegar cookies.txt (opcional)
```

### 2. Configurar Cloudflare Tunnel para la Pi

Sigue [`docs/CLOUDFLARE_TUNNEL.md`](docs/CLOUDFLARE_TUNNEL.md). Resumen:
- Túnel: `pi-tunnel` → `stream.tudominio.com` → `http://localhost:8000`

### 3. Deploy frontend en Vercel

Sigue [`docs/VERCEL_DEPLOY.md`](docs/VERCEL_DEPLOY.md). Resumen:
- Importa repo en [vercel.com/new](https://vercel.com/new)
- Añade env vars: `YOUTUBE_API_KEY`, `PI_STREAM_BASE=https://stream.tudominio.com`
- Conecta tu dominio `app.tudominio.com`

### 4. Verificar

```bash
curl https://app.tudominio.com/                    # frontend
curl https://stream.tudominio.com/health           # backend
```

Abre `https://app.tudominio.com/` en el navegador, busca una canción → debe sonar en <3s.

---

## Decisiones técnicas

### ¿Por qué Vercel y no VPS para el frontend?

- **Costo**: Vercel es gratis para tráfico normal (100GB/mes)
- **Performance**: CDN con 28 regiones globales, mucho mejor que 1 VPS en 1 región
- **Mantenimiento cero**: HTTPS automático, deploy con `git push`, sin systemd
- **Ban risk**: Vercel no toca YouTube — solo sirve estáticos. Cero riesgo
- **Escala**: Si tu app se vuelve viral, Vercel aguenta sin que tengas que tocar nada

### ¿Por qué la Pi y no Vercel para el backend?

- `yt-dlp` necesita Python y subprocess — Vercel serverless tiene 10s timeout
- La URL firmada de YouTube está **ligada a la IP del extractor** → necesitas IP fija (Pi)
- Cache SQLite persistente — Vercel serverless es stateless
- IP residencial de la Pi = alta confianza en YouTube

### ¿Por qué cookies.txt opcional?

Sin cookies funciona para la mayoría de videos, pero YouTube a veces pide verificación. Con cookies:
- Resuelves `Sign in to confirm you're not a bot`
- Accedes a videos con restricción de edad
- Sube el rate limit a ~2000/hora (vs 300 sin cookies)
- Recomendado para uso intensivo

**Importante**: usa cuenta secundaria por si la banean. Nunca tu cuenta principal.

### ¿Por qué cache de 5h?

Las URLs firmadas de YouTube duran ~6h. Cachear 5h deja margen. Si 100 oyentes escuchan la misma canción en ese rango, hacemos **1 sola extracción** en lugar de 100.

---

## Operación y mantenimiento

### Logs

```bash
# Pi 5 — backend
sudo journalctl -u pi-stream -f
tail -f ~/pi-stream/stream.log

# Pi 5 — cloudflared
sudo journalctl -u cloudflared -f

# Vercel — frontend
# Dashboard → tu proyecto → Logs (en vivo)
```

### Actualizar cookies.txt

```bash
# Subir nuevas cookies
scp cookies.txt pi@tu-pi:~/pi-stream/cookies.txt
ssh pi@tu-pi "sudo systemctl restart pi-stream"
```

### Cache DB

```bash
# Ver entradas activas
sqlite3 ~/pi-stream/cache.db "SELECT video_id, quality, datetime(created_ts,'unixepoch') as created, datetime(expire_ts,'unixepoch') as expires, hits FROM stream_cache WHERE expire_ts > strftime('%s','now') ORDER BY hits DESC LIMIT 20;"

# Limpiar expiradas
sqlite3 ~/pi-stream/cache.db "DELETE FROM stream_cache WHERE expire_ts < strftime('%s','now');"

# Invalidar una entrada específica
curl -X POST https://stream.tudominio.com/cache/expire -d "video_id=XXX" -d "quality=auto"
```

### Actualizar yt-dlp manualmente

```bash
ssh pi@tu-pi
cd ~/pi-stream
source venv/bin/activate
pip install --upgrade yt-dlp
sudo systemctl restart pi-stream
```

> El cron semanal (`update-yt-dlp.yml`) ya hace esto automáticamente cada lunes.

---

## Troubleshooting

### "Sign in to confirm you're not a bot"

YouTube pide captcha. Causas:
- Sin cookies → instálalas (ver sección 🍪 arriba)
- Rate limit alcanzado → revisa `extractions_last_hour` en `/health`
- IP marcada → para el servicio 1h y reintenta

### El audio no carga pero la búsqueda funciona

- Verifica `https://stream.tudominio.com/health` responde 200
- Verifica `PI_STREAM_BASE` en Vercel env vars
- Verifica Cloudflare Tunnel de la Pi online (Zero Trust → Tunnels → status)
- Revisa `~/pi-stream/stream.log` en la Pi

### Latencia alta (>3s)

- Cache miss + `--sleep-requests 1` esperando → normal la primera vez
- Pi sobrecargada → reduce workers en `pi-stream.service`
- Cloudflare Tunnel congestionado → revisa `cloudflared` logs

### yt-dlp se queja de formato no disponible

Algunos videos no tienen `bestaudio` separado. El fallback `bestaudio/best` debería manejarlo. Si falla:
```bash
yt-dlp -F "https://youtu.be/VIDEO_ID"  # lista formatos disponibles
```

---

## Costos

| Recurso | Costo mensual |
|---------|---------------|
| Vercel (free tier) | $0 |
| Cloudflare Tunnel + DNS | $0 |
| YouTube Data API v3 (10k cuota/día) | $0 |
| Pi 5 (one-time) | ya la tienes |
| Dominio | ~$10/año |
| **Total** | **~$0.83/mes** (solo dominio) |

---

## Limitaciones conocidas

- **No descarga de videos**, solo audio en streaming
- **No reproduce playlists** automáticamente
- **No busca en YouTube Music Premium** (solo catálogo gratuito)
- **Calidad limitada a `bestaudio`** (no 1080p+ porque requiere PO Token)
- **Una sola IP residencial** — si necesitas más capacidad, añade nodos (Termux LTE, segunda casa)

---

## Próximos pasos sugeridos

1. **Monitoreo**: UptimeRobot monitorizando `/health` de la Pi
2. **Pre-warming**: cuando alguien busca, pre-extraer las primeras 3 canciones
3. **Historial de reproducción**: tabla SQLite en Vercel con Prisma
4. **Favoritos**: botón ♡ que guarda en localStorage
5. **Modo radio**: autoplay de canciones similares
6. **Multi-extractor**: sumar Termux en tu celular como segundo nodo del pool
