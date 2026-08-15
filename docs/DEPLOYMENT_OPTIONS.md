# Opciones de deployment con GitHub Actions

Tienes **4 estrategias** para actualizar Pi y VPS automáticamente. Elige según tu nivel de paranoía y disponibilidad.

---

## Opción 1 — SSH directo (recomendada, ya implementada)

**Cómo funciona**: GitHub Actions hace SSH a tus máquinas y ejecuta `git pull` + restart.

**Workflows ya creados**:
- `.github/workflows/deploy-pi.yml` — push a `main` → actualiza Pi
- `.github/workflows/deploy-vps.yml` — push a `main` → actualiza VPS
- `.github/workflows/update-yt-dlp.yml` — cron semanal → actualiza yt-dlp
- `.github/workflows/ci.yml` — PR/push → lint + build check

### Setup (5 minutos)

**1. Generar SSH keys dedicadas** (en tu PC local):

```bash
# Key para la Pi
ssh-keygen -t ed25519 -f ~/.ssh/harmonix_pi -C "github-actions-pi" -N ""

# Key para el VPS
ssh-keygen -t ed25519 -f ~/.ssh/harmonix_vps -C "github-actions-vps" -N ""
```

**2. Copiar la public key a cada máquina**:

```bash
# En la Pi
ssh-copy-id -i ~/.ssh/harmonix_pi.pub pi@tu-pi.local

# En el VPS
ssh-copy-id -i ~/.ssh/harmonix_vps.pub user@tu-vps.com
```

**3. Configurar secrets en GitHub**:

Ve a `https://github.com/SantiagortegaDev/harmonix-server/settings/secrets/actions` y añade:

| Secret | Valor |
|--------|-------|
| `PI_HOST` | `stream.tudominio.com` o IP pública de la Pi |
| `PI_USER` | `pi` (o tu usuario) |
| `PI_SSH_KEY` | contenido de `~/.ssh/harmonix_pi` (la privada) |
| `PI_SSH_PORT` | `22` (o el puerto SSH de la Pi) |
| `VPS_HOST` | `app.tudominio.com` o IP del VPS |
| `VPS_USER` | tu usuario en el VPS |
| `VPS_SSH_KEY` | contenido de `~/.ssh/harmonix_vps` |
| `VPS_SSH_PORT` | `22` |
| `MAIN_DOMAIN` | `tudominio.com` (sin subdominio) |

**4. Listo**. Haz un push a `main` y se desplegará solo:

```bash
git push origin main
# → trigger deploy-pi.yml + deploy-vps.yml + ci.yml
```

### Ventajas
- ✅ Cero infraestructura extra
- ✅ Logs visibles en la tab Actions
- ✅ Rollback fácil: `git revert` + push
- ✅ Solo corre en push a `main` (PRs no disparan deploy)

### Desventajas
- ⚠️ Requiere que las máquinas tengan SSH accesible desde internet
- ⚠️ Si GitHub Actions IP cambia, los firewalls pueden bloquearlo (raro)

---

## Opción 2 — Webhook + agente local en cada máquina

**Cómo funciona**: En lugar de SSH desde GitHub, instalas un agente en cada máquina que escucha un webhook de GitHub y ejecuta `git pull` cuando recibe la señal.

### Setup

**1. En cada máquina (Pi y VPS), instalar webhookd**:

```bash
# En la Pi
sudo apt install webhookd
sudo tee /etc/webhookd/conf.d/harmonix.yaml <<EOF
hook: harmonix-deploy
command: |
  cd ~/pi-stream-src && git pull --ff-only
  cp pi-backend/main.py ~/pi-stream/
  cp pi-backend/requirements.txt ~/pi-stream/
  cd ~/pi-stream
  source venv/bin/activate
  pip install -r requirements.txt --quiet
  sudo systemctl restart pi-stream
EOF
sudo systemctl enable --now webhookd
# Puerto 9000 por defecto
```

**2. Exponer webhookd vía Cloudflare Tunnel**:
- `webhook-pi.tudominio.com` → `http://localhost:9000` (Pi)
- `webhook-vps.tudominio.com` → `http://localhost:9000` (VPS)

**3. Configurar webhook en GitHub**:
- Repo → Settings → Webhooks → Add webhook
- Payload URL: `https://webhook-pi.tudominio.com/hooks/harmonix-deploy`
- Content type: `application/json`
- Trigger: `push` event
- Secret: el que configures en webhookd

### Ventajas
- ✅ Las máquinas no necesitan SSH expuesto
- ✅ Más seguro si expones webhooks detrás de Cloudflare Access

### Desventajas
- ⚠️ Más piezas móviles (webhookd corriendo en cada máquina)
- ⚠️ Otro servicio para mantener

---

## Opción 3 — GitHub Runner self-hosted en la Pi

**Cómo funciona**: Instalas el runner de GitHub Actions directamente en la Pi. Los workflows corren localmente sin necesidad de SSH ni webhooks.

### Setup

**1. En la Pi, instalar runner**:

```bash
# Repo → Settings → Actions → Runners → New self-hosted runner
# Sigue las instrucciones para Linux ARM64
mkdir actions-runner && cd actions-runner
curl -o actions-runner-linux-arm64-2.317.0.tar.gz -L \
  https://github.com/actions/runner/releases/download/v2.317.0/actions-runner-linux-arm64-2.317.0.tar.gz
tar xzf actions-runner-linux-arm64-2.317.0.tar.gz
./config.sh --url https://github.com/SantiagortegaDev/harmonix-server \
  --token <TOKEN_DEL_REPO>
sudo ./svc.sh install
sudo ./svc.sh start
```

**2. Modificar workflow para usar self-hosted runner**:

```yaml
jobs:
  deploy-pi:
    runs-on: self-hosted  # en vez de ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy local
        run: |
          # Ya estamos en la Pi, ejecutar directo
          cd ~/pi-stream
          cp $GITHUB_WORKSPACE/pi-backend/main.py .
          source venv/bin/activate
          pip install -r requirements.txt --quiet
          sudo systemctl restart pi-stream
```

### Ventajas
- ✅ Sin SSH expuesto, sin webhooks
- ✅ Acceso directo a recursos locales
- ✅ Ideal para deploy en infraestructura propia

### Desventajas
- ⚠️ Consume RAM y CPU en la Pi (runner usa ~50-100MB)
- ⚠️ Si la Pi está caída, no se actualiza
- ⚠️ Solo útil si tienes UNA Pi (para múltiples Pi necesitas un runner por cada una)

---

## Opción 4 — Docker + Pull-based

**Cómo funciona**: Construyes imágenes Docker en GitHub Actions, las subes a GitHub Container Registry, y en cada máquina hay un `cron` que hace `docker pull && docker compose up -d`.

### Setup

**1. Crear Dockerfile para el backend**:

```dockerfile
# pi-backend/Dockerfile
FROM python:3.12-slim
RUN apt-get update && apt-get install -y ffmpeg yt-dlp sqlite3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**2. Workflow para construir y push imagen**:

```yaml
# .github/workflows/docker-build.yml
name: Build Docker image
on:
  push:
    branches: [main]
    paths: ['pi-backend/**']
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          context: ./pi-backend
          push: true
          tags: ghcr.io/santiagortegadev/harmonix-backend:latest
```

**3. En la Pi, cron cada 5 min**:

```bash
# /etc/cron.d/harmonix-pull
*/5 * * * * pi docker pull ghcr.io/santiagortegadev/harmonix-backend:latest && \
  docker compose -f /home/pi/harmonix/compose.yml up -d --force-recreate
```

### Ventajas
- ✅ Rollbacks instantáneos (`docker run <old-tag>`)
- ✅ Imágenes reproducibles (mismo código en dev y prod)
- ✅ Cero SSH desde GitHub

### Desventajas
- ⚠️ Docker en Pi consume más recursos (~200MB extra)
- ⚠️ Complejidad inicial alta
- ⚠️ No recomendado para Pi 5 con <4GB RAM

---

## Recomendación para tu caso

| Tu situación | Recomendación |
|--------------|---------------|
| Solo tú mantienes el repo, quieres simple | **Opción 1 (SSH)** — ya implementada |
| No quieres SSH expuesto | **Opción 3 (self-hosted runner)** |
| Quieres rollbacks industriales | **Opción 4 (Docker)** |
| Tienes múltiples Pis en el futuro | **Opción 2 (webhook)** o **Opción 4** |

**Para empezar**: usa la **Opción 1** que ya está implementada. Si en el futuro necesitas más seguridad o escalabilidad, migra a Opción 3 o 4.

---

## Secrets necesarios (resumen)

Para la **Opción 1** (la recomendada), ve a:
`https://github.com/SantiagortegaDev/harmonix-server/settings/secrets/actions`

| Secret | Descripción | Ejemplo |
|--------|-------------|---------|
| `PI_HOST` | Host de la Pi (dominio o IP) | `stream.tudominio.com` |
| `PI_USER` | Usuario SSH en la Pi | `pi` |
| `PI_SSH_KEY` | SSH private key completa | (contenido de `~/.ssh/harmonix_pi`) |
| `PI_SSH_PORT` | Puerto SSH | `22` |
| `VPS_HOST` | Host del VPS | `app.tudominio.com` |
| `VPS_USER` | Usuario SSH en VPS | `deploy` |
| `VPS_SSH_KEY` | SSH private key completa | (contenido de `~/.ssh/harmonix_vps`) |
| `VPS_SSH_PORT` | Puerto SSH | `22` |
| `MAIN_DOMAIN` | Dominio principal sin subdominio | `tudominio.com` |

> ℹ️ `GITHUB_TOKEN` se inyecta automáticamente, no necesitas crearlo.
