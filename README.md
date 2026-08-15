# Pi Stream — YouTube Music Streaming con Raspberry Pi 5

Streaming ultra-rápido de YouTube Music con arquitectura anti-ban: la Pi 5 (IP residencial) extrae las URLs firmadas con `yt-dlp`, las cachea en SQLite con TTL 5h, y hace passthrough hacia los clientes. El frontend Next.js (servido desde un VPS pequeño) solo maneja búsqueda y UI.

```
Usuario → app.tudominio.com (VPS) → YouTube Data API v3 (búsqueda)
         ↓ click en canción
         stream.tudominio.com (Pi 5 vía Cloudflare Tunnel)
         ↓
         Cache SQLite → hit? → passthrough a googlevideo
                       miss? → yt-dlp -g → cache → passthrough
```

**Latencia objetivo**: <3s desde click hasta audio sonando (cache hit <50ms, primer play 1.5-2s).

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│  Cloudflare (DNS + 2 Tunnels)                                   │
│  app.tudominio.com    → VPS (frontend Next.js)                  │
│  stream.tudominio.com → Pi 5 (backend FastAPI)                  │
└─────────────────────────────────────────────────────────────────┘
         │                                       │
         ▼                                       ▼
┌────────────────────────┐         ┌──────────────────────────────┐
│  VPS pequeño            │         │  Raspberry Pi 5               │
│  - Next.js 16 (Node)    │         │  - FastAPI + uvicorn          │
│  - API key YouTube      │         │  - yt-dlp + ffmpeg            │
│  - Caddy reverse proxy  │         │  - SQLite cache (5h TTL)      │
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
- La Pi tiene IP residencial del ISP → YouTube la trata como usuario normal
- Cache de 5h → si 100 personas escuchan la misma canción, solo 1 extracción
- `yt-dlp --sleep-requests 1` + rate limit 250 extracciones/hora (límite YT: 300)
- Reverse-proxy preserva IP de la Pi hacia googlevideo (la URL está firmada para esa IP)

---

## Estructura del proyecto

```
my-project/
├── src/                          # Frontend Next.js 16
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
│   ├── main.py                   # App FastAPI: cache + yt-dlp + passthrough
│   ├── requirements.txt          # fastapi, uvicorn, httpx, yt-dlp
│   ├── pi-stream.service         # systemd unit file
│   └── .env.example
│
├── deploy/                       # Scripts de instalación
│   ├── setup-pi.sh               # Instala backend en Pi 5
│   └── setup-vps.sh              # Instala frontend en VPS
│
├── docs/
│   └── CLOUDFLARE_TUNNEL.md      # Guía detallada de túneles
│
└── .env.example                  # Variables del frontend
```

---

## Quick start (15 minutos)

### Prerrequisitos

- [ ] Raspberry Pi 5 con Raspberry Pi OS (bookworm) + conexión a internet casera
- [ ] VPS pequeño (1 vCPU, 1GB RAM) con Debian/Ubuntu
- [ ] Dominio en Cloudflare (DNS mode orange-cloud)
- [ ] Cuenta de Google Cloud con YouTube Data API v3 habilitada
- [ ] Token de Cloudflare Tunnel (Zero Trust → Tunnels)

### 1. Obtener YouTube Data API key

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Crea un proyecto nuevo → habilita **YouTube Data API v3**
3. Credenciales → Crear API key → copia el valor
4. **Restricción por IP**: en la config de la key, añade la IP pública del VPS

### 2. Configurar Cloudflare Tunnel (2 túneles)

Sigue la guía detallada en [`docs/CLOUDFLARE_TUNNEL.md`](docs/CLOUDFLARE_TUNNEL.md). Resumen:

- Túnel 1 `vps-tunnel`: `app.tudominio.com` → `http://localhost:80` (VPS)
- Túnel 2 `pi-tunnel`: `stream.tudominio.com` → `http://localhost:8000` (Pi 5)

### 3. Desplegar frontend en VPS

Copia la carpeta del proyecto al VPS y ejecuta:

```bash
scp -r my-project/ user@vps:~/
ssh user@vps
cd my-project
bash deploy/setup-vps.sh
# El script pedirá tu dominio (app.tudominio.com)
```

Edita `.env` con tu API key:
```bash
nano ~/pi-stream-frontend/.env
# YOUTUBE_API_KEY=AIza...
# PI_STREAM_BASE=https://stream.tudominio.com
sudo systemctl restart pi-stream-frontend
```

### 4. Desplegar backend en Pi 5

Copia solo la carpeta `pi-backend/` a la Pi:

```bash
scp -r my-project/pi-backend/ pi@raspberrypi:~/pi-stream-src
ssh pi@raspberrypi
cd ~/pi-stream-src
bash setup-pi.sh
# O si copiaste solo pi-backend a ~/pi-stream-src:
# cp -r pi-backend ~/pi-stream-src && cd ~/pi-stream-src && bash setup-pi.sh
```

> Nota: el script `setup-pi.sh` está en `deploy/`, no en `pi-backend/`. Asegúrate de copiarlo también.

### 5. Instalar Cloudflare Tunnel en cada máquina

**En el VPS:**
```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cf.deb
sudo dpkg -i /tmp/cf.deb
sudo cloudflared service install <TOKEN_VPS_TUNNEL>
```

**En la Pi 5:**
```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -o /tmp/cf.deb
sudo dpkg -i /tmp/cf.deb
sudo cloudflared service install <TOKEN_PI_TUNNEL>
```

### 6. Verificar

```bash
# Frontend
curl https://app.tudominio.com/

# Backend
curl https://stream.tudominio.com/health
```

Abre `https://app.tudominio.com/` en el navegador, busca una canción, click → debe sonar en menos de 3 segundos.

---

## Decisiones técnicas

### ¿Por qué el frontend NO habla directo con YouTube Music?

La API pública de YouTube Data v3 es solo para **metadata** (búsqueda, títulos, thumbnails). Para obtener el audio hay que extraer la URL firmada del `videoplayback` endpoint, y esa URL está:

1. **Atada a la IP del extractor** → si el VPS la pide y el navegador la reproduce, falla
2. **Caduca en 6h** → hay que cachearla y renovarla

Por eso el backend de la Pi hace de **proxy transparente**: el navegador pide a la Pi, la Pi reenvía a googlevideo preservando su propia IP.

### ¿Por qué la Pi y no el VPS para extraer?

YouTube bloquea IPs de datacenter por reputación. La Pi tiene IP residencial del ISP (alta confianza en YouTube). El VPS solo sirve HTML/JS estático — nunca toca `youtube.com` o `googlevideo.com`.

### ¿Por qué cache de 5h?

Las URLs firmadas de YouTube duran ~6h. Cachear 5h deja margen de seguridad. Si 100 oyentes escuchan la misma canción en ese rango, hacemos **1 sola extracción** en lugar de 100 — esto es lo que evita el ban.

### ¿Por qué `--sleep-requests 1` y no más agresivo?

YouTube limita a ~300 extracciones/hora por IP invitada. Nos quedamos en 250 para tener margen. Con cache activa, rara vez llegamos al límite en una Pi casera.

### ¿Por qué `player_client=mweb`?

El cliente mobile-web de YouTube tiene menos validaciones que `web` o `android`. Es el más estable cuando no usas PO Token. Sacrificas formatos 1080p+ (que no necesitamos para audio).

### ¿Por qué Caddy y no nginx?

Caddy hace HTTPS automático con Let's Encrypt sin configuración. Para un VPS pequeño donde solo necesitas reverse proxy hacia Next.js, Caddy es 5 líneas de config vs 50 de nginx.

### ¿Por qué FastAPI y no Express/Node?

`yt-dlp` es Python. Llamarlo desde Python con `subprocess` es natural. FastAPI además:
- Async nativo → el passthrough HTTP no bloquea el event loop
- StreamingResponse → ideal para reenviar bytes de googlevideo
- SQLite estándar de Python, sin dependencias externas

---

## Operación y mantenimiento

### Logs

```bash
# VPS — frontend
sudo journalctl -u pi-stream-frontend -f

# Pi 5 — backend
sudo journalctl -u pi-stream -f
tail -f ~/pi-stream/stream.log

# Pi 5 — cloudflared
sudo journalctl -u cloudflared -f
```

### Cache DB

```bash
# Ver entradas activas
sqlite3 ~/pi-stream/cache.db "SELECT video_id, quality, datetime(created_ts,'unixepoch') as created, datetime(expire_ts,'unixepoch') as expires, hits FROM stream_cache WHERE expire_ts > strftime('%s','now') ORDER BY hits DESC LIMIT 20;"

# Limpiar expiradas (lo hace automáticamente, pero por si acaso)
sqlite3 ~/pi-stream/cache.db "DELETE FROM stream_cache WHERE expire_ts < strftime('%s','now');"

# Invalidar una entrada específica
curl -X POST https://stream.tudominio.com/cache/expire -d "video_id=XXX" -d "quality=auto"
```

### Actualizar yt-dlp

YouTube cambia su API frecuentemente. yt-dlp publica fixes cada semana. Actualiza:

```bash
ssh pi@raspberrypi
cd ~/pi-stream
source venv/bin/activate
pip install --upgrade yt-dlp
sudo systemctl restart pi-stream
```

Recomendado: cron semanal:
```bash
# crontab -e
0 4 * * 1 /home/pi/pi-stream/venv/bin/pip install --upgrade yt-dlp --quiet && /usr/bin/sudo /bin/systemctl restart pi-stream
```

### Backups

Solo necesitas backupear:
- `~/pi-stream/.env` (configuración)
- Código fuente (en git)

El `cache.db` se regenera solo. Los logs rotan con logrotate automáticamente.

---

## Troubleshooting

### "Sign in to confirm you're not a bot"

YouTube está pidiendo captcha. Causas:
- Rate limit alcanzado (revisa `extractions_last_hour` en `/health`)
- IP residencial marcada (raro pero posible tras pico de uso)

Solución temporal: para el servicio 1h, deja que se enfríe la IP. Si persiste, considera sumar otro extractor (Termux en celular con LTE).

### El audio no carga pero la búsqueda sí funciona

- Verifica `https://stream.tudominio.com/health` responde 200
- Verifica que `PI_STREAM_BASE` en el `.env` del frontend apunta al subdominio correcto
- Verifica que el Cloudflare Tunnel de la Pi está online (Zero Trust → Tunnels → status)
- Revisa `~/pi-stream/stream.log` en la Pi

### Latencia alta (>3s)

Posibles causas:
- Cache miss + `--sleep-requests 1` se está esperando → normal la primera vez
- Pi sobrecargada (CPU >80%) → reduce workers en `pi-stream.service`
- Cloudflare Tunnel congestionado → revisa `cloudflared` logs

### yt-dlp se queja de formato no disponible

Algunos videos no tienen `bestaudio` separado. El fallback `bestaudio/best` debería manejarlo, pero si falla:
```bash
yt-dlp -F "https://youtu.be/VIDEO_ID"  # lista formatos disponibles
```

Ajusta el formato en `YTDLP_BASE_ARGS` de `main.py` si necesitas algo específico.

---

## Costos

| Recurso | Costo mensual |
|---------|---------------|
| VPS pequeño (Hetzner CX22, Contabo VPS S, OVH VPS Starter) | ~$4-5 |
| Cloudflare Tunnel + DNS | $0 |
| YouTube Data API v3 (10k cuota/día) | $0 |
| Pi 5 (one-time) | ya la tienes |
| Dominio (si no tienes) | ~$10/año |
| **Total** | **~$5/mes** |

---

## Limitaciones conocidas

- **No descarga de videos**, solo audio en streaming
- **No reproduce playlists** automáticamente (puedes añadirlo al frontend)
- **No busca en YouTube Music Premium** (solo catálogo gratuito)
- **Calidad limitada a `bestaudio`** (no 1080p+ porque requiere PO Token)
- **Una sola IP residencial** — si necesitas más capacidad, añade nodos (Termux LTE, segunda casa)

---

## Próximos pasos sugeridos

1. **Monitoreo**: añade UptimeRobot o Better Stack monitorizando `/health` de la Pi
2. **Pre-warming opcional**: cuando alguien busca, el backend podría pre-extraer las primeras 3 canciones
3. **Historial de reproducción**: tabla SQLite en el frontend con Prisma
4. **Favoritos**: añadir botón ♡ que guarda en localStorage o cuenta
5. **Modo radio**: autoplay de canciones similares tras la actual
6. **Multi-extractor**: sumar Termux en tu celular como segundo nodo del pool
