# Deploy del frontend en Vercel

Vercel sirve el frontend Next.js gratis con CDN global, HTTPS automático y deploy automático con `git push`. La Pi 5 sigue siendo el backend (streaming).

```
Usuario → app.tudominio.com (Vercel CDN) → YouTube Data API v3 (búsqueda)
         ↓ click en canción
         stream.tudominio.com (Pi 5 vía Cloudflare Tunnel)
         ↓
         yt-dlp + cache + passthrough
```

---

## Paso 1 — Importar el repo en Vercel

1. Ve a [vercel.com/new](https://vercel.com/new)
2. Conecta tu cuenta de GitHub si no lo está
3. Selecciona el repo `SantiagortegaDev/harmonix-server`
4. Vercel detecta Next.js automáticamente, no hace falta config

**Configuración del proyecto**:
- Framework Preset: **Next.js** (auto-detectado)
- Build Command: `next build` (default)
- Output Directory: `.next` (default)
- Install Command: `bun install` o `npm install` (Vercel detecta bun.lock)

5. Click **Deploy**. En ~1 min está en producción en `https://harmonix-server.vercel.app` (o similar).

---

## Paso 2 — Configurar variables de entorno

En Vercel → tu proyecto → **Settings** → **Environment Variables**:

| Nombre | Valor | Entornos |
|--------|-------|----------|
| `YOUTUBE_API_KEY` | `AIza...` (tu API key) | Production, Preview, Development |
| `PI_STREAM_BASE` | `https://stream.tudominio.com` | Production, Preview, Development |

> ℹ️ `PI_STREAM_BASE` debe apuntar al subdominio de la Pi (vía Cloudflare Tunnel), NO a Vercel.

Después de añadir las variables, redesploea:
- Deployments → último deploy → **Redeploy**

---

## Paso 3 — Conectar tu dominio

1. En Vercel → tu proyecto → **Settings** → **Domains**
2. Añade `app.tudominio.com`
3. Vercel te da un record CNAME para añadir en Cloudflare:
   - Tipo: `CNAME`
   - Name: `app`
   - Target: `cname.vercel-dns.com`
   - Proxied: **NO** (DNS only, grey cloud) — Vercel necesita resolver directamente
4. Espera 1-5 min a que Vercel verify el dominio (te da HTTPS automático)

> ⚠️ **Importante**: NO pongas `app.tudominio.com` detrás del proxy naranja de Cloudflare — Vercel necesita manejar HTTPS directamente. El grey-cloud es obligatorio.

---

## Paso 4 — Deploy automático

A partir de aquí, cada `git push origin main` dispara:

1. GitHub Actions corre `ci.yml` (lint + build check)
2. GitHub Actions corre `deploy-vercel.yml` (verifica que el build pasa)
3. Vercel detecta el push automáticamente y deploya en ~30s
4. Vercel te notifica por email/Slack cuando termina

Si Vercel no deploya automáticamente (raro), puedes dispararlo manualmente:
- Vercel dashboard → Deployments → **Redeploy**
- O desde GitHub: Actions tab → "Deploy to Vercel" → Run workflow

---

## Verificación final

Después de completar los pasos:

```bash
# 1. Frontend responde
curl -I https://app.tudominio.com/
# HTTP/2 200

# 2. Backend responde
curl https://stream.tudominio.com/health
# {"status":"ok","service":"pi-stream","stats":{...}}

# 3. Búsqueda funciona
curl "https://app.tudominio.com/api/search?q=bad+bunny" | jq '.items[0].title'
# "Bad Bunny - Titulo Me Conoces"

# 4. Stream funciona
curl -I "https://stream.tudominio.com/stream/dQw4w9WgXcQ?quality=auto"
# HTTP/2 200 + Content-Type: audio/webm
```

Abre `https://app.tudominio.com/` en el navegador, busca una canción, click → debe sonar en menos de 3 segundos.

---

## Ventajas de Vercel vs VPS para el frontend

| Aspecto | Vercel (gratis) | VPS 256MB |
|---------|-----------------|-----------|
| Setup | 5 min | 30+ min |
| HTTPS | Automático | Manual con Caddy/certbot |
| CDN | 28 regiones globales | 1 región |
| Deploy | `git push` | SSH + build + restart |
| RAM | Ilimitada (serverless) | 256MB justo |
| Costo | $0 | $4-5/mes |
| Mantenimiento | Cero | systemd, logs, updates |
| Ban risk | Cero (no toca YouTube) | Cero (igual) |

**Único caso donde VPS sería mejor**: si quieres tener todo en infraestructura propia por privacidad. Para todo lo demás, Vercel gana.

---

## Troubleshooting

### "Function timeout" en /api/search

Vercel tiene un timeout de 10s en funciones serverless (plan free). La API de YouTube suele responder en <1s, pero si la API key está mal configurada o hay latencia alta, puede timeoutar.

Solución: verifica que `YOUTUBE_API_KEY` esté en Production environment (no solo en Development).

### Thumbnails no cargan

YouTube sirve thumbnails desde `i.ytimg.com`. Si Cloudflare bloquea la imagen por CORS mixed-content:

1. Verifica que tu dominio Vercel tiene HTTPS (Vercel lo hace automático)
2. Si sigue fallando, añade un proxy en `next.config.ts`:

```ts
const nextConfig = {
  async rewrites() {
    return [
      { source: '/_ytimg/:path*', destination: 'https://i.ytimg.com/:path*' }
    ]
  }
}
```

### Deploy falla por `.env` faltante

Vercel no necesita `.env` local — usa **Environment Variables** del dashboard. Si el build falla por missing env var, ve a Settings → Environment Variables y añádela.

### Quiero desactivar auto-deploy

Si quieres deployar solo manualmente:
1. Vercel → Settings → Git → **Production Branch**: cambia a una rama que no existe (ej: `production`)
2. Ahora `git push origin main` NO deploya — necesitas mergear a `production` para deployar
3. O usa el botón "Redeploy" manualmente

---

## Migrar de VPS a Vercel (si ya tenías VPS)

Si ya tenías el frontend corriendo en un VPS:

1. **Exporta tus variables de entorno** del VPS:
   ```bash
   ssh user@vps "cat ~/pi-stream-frontend/.env"
   ```
2. **Imprta el repo en Vercel** (Paso 1 de arriba)
3. **Añade las variables** en Vercel (Paso 2)
4. **Actualiza DNS** en Cloudflare:
   - Cambia el CNAME de `app.tudominio.com` de tu VPS a `cname.vercel-dns.com`
5. **Espera 5 min** a que DNS propague
6. **Apaga el VPS** cuando confirmes que Vercel funciona

Ya no necesitas mantener el VPS para el frontend.
