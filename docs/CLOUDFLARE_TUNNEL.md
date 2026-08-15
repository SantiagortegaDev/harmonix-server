# Cloudflare Tunnel — Guía de configuración

Esta guía cubre los **2 túneles** necesarios para exponer tu infraestructura:

1. **`app.tudominio.com`** → VPS (frontend Next.js)
2. **`stream.tudominio.com`** → Pi 5 (backend FastAPI)

Ambos pueden usar el mismo túnel o túneles separados. Recomendado: **un solo túnel por máquina** con múltiples public hostnames.

---

## Paso 1 — Crear los túneles en Cloudflare

1. Ve a **Cloudflare Zero Trust** → **Networks** → **Tunnels**
2. Click **Create a tunnel** → tipo **Cloudflared**
3. Nombra el túnel `vps-tunnel` (para el VPS) y crea otro `pi-tunnel` (para la Pi)
4. En cada túnel, copia el **token** que aparece en la pestaña "Install and run connector"

---

## Paso 2 — Configurar el VPS (frontend)

En el VPS, después de correr `setup-vps.sh`:

```bash
# Instalar cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cf.deb
sudo dpkg -i /tmp/cf.deb

# Instalar como servicio con el token del túnel 'vps-tunnel'
sudo cloudflared service install <TOKEN_VPS_TUNNEL>
```

Luego en el dashboard de Cloudflare Zero Trust → Tunnels → `vps-tunnel` → **Public Hostnames**:

| Subdomain | Domain | Path | Service |
|-----------|--------|------|---------|
| app | tudominio.com | - | `http://localhost:80` |

> Caddy escucha en `:80` (y `:443` automáticamente para HTTPS interno). Cloudflare Tunnel enruta hacia `:80`.

Verifica desde tu máquina local:
```bash
curl -I https://app.tudominio.com/
# Debe devolver 200 OK o 301
```

---

## Paso 3 — Configurar la Pi 5 (backend)

En la Pi, después de correr `setup-pi.sh`:

```bash
# Instalar cloudflared (versión ARM64)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -o /tmp/cf.deb
sudo dpkg -i /tmp/cf.deb

# Instalar como servicio con el token del túnel 'pi-tunnel'
sudo cloudflared service install <TOKEN_PI_TUNNEL>
```

En el dashboard de Cloudflare Zero Trust → Tunnels → `pi-tunnel` → **Public Hostnames**:

| Subdomain | Domain | Path | Service |
|-----------|--------|------|---------|
| stream | tudominio.com | - | `http://localhost:8000` |

**IMPORTANTE — Configuración adicional del túnel de la Pi:**

Como el backend hace streaming de audio potencialmente largo, ajusta estos parámetros en la configuración del túnel (Zero Trust → Settings → **Tunnel**):

- **HTTP/2**: Activado (mejor para streaming)
- **WebSocket**: Activado (no es necesario aquí pero no estorba)
- **No TLS Verify**: NO (mantener verificación)
- **Connection timeout**: 0 (sin timeout, el stream puede durar minutos)
- **Keep-alive connections**: 100
- **Keep-alive timeout**: 30s

Verifica desde tu máquina local:
```bash
curl https://stream.tudominio.com/health
# Debe devolver: {"status":"ok","service":"pi-stream","stats":{...}}
```

---

## Paso 4 — Configurar el frontend para usar el backend

Edita `.env` en el VPS donde corre el frontend:

```bash
# /home/<user>/pi-stream-frontend/.env
YOUTUBE_API_KEY=AIza...       # tu API key
PI_STREAM_BASE=https://stream.tudominio.com
```

Reinicia:
```bash
sudo systemctl restart pi-stream-frontend
```

---

## Paso 5 — DNS en Cloudflare

Cloudflare Tunnel crea los records CNAME automáticamente cuando configuras los public hostnames en el dashboard. NO necesitas crear records manualmente.

Si prefieres hacerlo manualmente, los records deben apuntar a:
- `app.tudominio.com` → `<vps-tunnel-id>.cfargotunnel.com` (CNAME, **Proxied** = orange cloud)
- `stream.tudominio.com` → `<pi-tunnel-id>.cfargotunnel.com` (CNAME, **Proxied** = orange cloud)

---

## Paso 6 — Seguridad adicional

### Restringir YouTube API Key por IP

En Google Cloud Console → APIs & Services → Credentials → tu API key → **Application restrictions** → **IP addresses** → añade la IP pública del VPS.

Esto evita que alguien robe tu key y la use desde otro sitio.

### Cloudflare Access (opcional)

Si quieres añadir capa de auth, en Cloudflare Zero Trust → **Access** → **Applications**:
- Crea una aplicación para `app.tudominio.com` con policy de email allowlist
- Esto protege el frontend sin tocar código

Para `stream.tudominio.com` NO pongas Access porque rompería el streaming desde el navegador.

### Rate limiting en Cloudflare

En Cloudflare dashboard → Security → **WAF** → **Rate limiting rules**:
- `stream.tudominio.com` → 60 req/min por IP para `/stream/*`
- Esto evita abuso sin afectar uso normal

---

## Verificación final end-to-end

Desde tu navegador:

1. **Frontend**: `https://app.tudominio.com` → debe cargar la UI MD3 con el buscador
2. **Búsqueda**: busca "Bad Bunny" → deben aparecer ~25 resultados
3. **Click en una canción** → debe sonar en <3s
4. **Backend health**: `https://stream.tudominio.com/health` → debe devolver JSON con stats
5. **Cache stats**: tras reproducir, el `cache_hits` debe aumentar al repetir la misma canción

### Diagnóstico si algo falla

```bash
# En el VPS
sudo journalctl -u pi-stream-frontend -f
curl -v http://127.0.0.1:3000/

# En la Pi
sudo journalctl -u pi-stream -f
curl -v http://127.0.0.1:8000/health

# Probar yt-dlp manualmente en la Pi
cd ~/pi-stream
venv/bin/yt-dlp -g -f bestaudio --no-warnings \
  --extractor-args "youtube:player_client=mweb" \
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# Estado del túnel
sudo systemctl status cloudflared
sudo journalctl -u cloudflared -f
```

---

## Costos

| Recurso | Costo |
|---------|-------|
| Cloudflare Tunnel | Gratis (hasta 50 usuarios con Access) |
| Cloudflare DNS | Gratis |
| VPS pequeño (1 vCPU, 1GB RAM) | ~$4-5/mes (Hetzner, Contabo, OVH) |
| Pi 5 (one-time) | ~$80-120 (ya la tienes) |
| YouTube Data API v3 | Gratis hasta 10,000 unidades/día |
| **Total** | **~$5/mes** |
