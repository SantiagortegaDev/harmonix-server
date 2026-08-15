"""
Pi Stream Backend — FastAPI + yt-dlp + SQLite cache + passthrough proxy.

Arquitectura:
  1. Recibe GET /stream/{video_id}?quality=auto|best|128|192
  2. Mira cache SQLite (video_id, quality) → url_firmada
  3. Si cache hit y TTL > ahora+10min → passthrough directo a googlevideo
  4. Si cache miss → yt-dlp -g para obtener URL firmada nueva, cachea, passthrough
  5. Passthrough: stream HTTP hacia googlevideo preservando rango/bytes
     (necesario porque la URL firmada está ligada a ESTA IP residencial)

La Pi 5 corre esto. Cloudflare Tunnel expone /stream/* hacia stream.tudominio.com.

Endpoints:
  GET /health              → status + cache stats
  GET /stream/{video_id}   → audio stream (passthrough)
  GET /info/{video_id}     → metadata sin descargar
  POST /cache/expire       → invalida una entrada (admin)
"""

import asyncio
import logging
import os
import sqlite3
import subprocess
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse, parse_qs, unquote

import aiohttp
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse

# ============================================================
# CONFIG
# ============================================================

BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR / "cache.db"
LOG_PATH = BASE_DIR / "stream.log"

CACHE_TTL = int(os.getenv("CACHE_TTL", "18000"))  # 5h (la URL dura 6h)
RATE_LIMIT_WINDOW = int(os.getenv("RATE_LIMIT_WINDOW", "3600"))  # 1h
RATE_LIMIT_MAX = int(os.getenv("RATE_LIMIT_MAX", "250"))  # <300 de YouTube
LISTEN_PORT = int(os.getenv("LISTEN_PORT", "8000"))
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*").split(",")

# --- Cookies opcionales ---
# USE_COOKIES=true activa el uso de cookies.txt para resolver errores
# "Sign in to confirm you're not a bot" y similares.
# El archivo debe llamarse cookies.txt y estar junto a main.py.
USE_COOKIES = os.getenv("USE_COOKIES", "false").lower() == "true"
COOKIES_PATH = BASE_DIR / "cookies.txt"

# yt-dlp binario — resolver ruta absoluta al venv local.
# Esto es CRÍTICO porque systemd ejecuta uvicorn directamente
# (sin 'source venv/bin/activate'), por lo que el PATH del proceso
# no incluye venv/bin. Si dejamos solo "yt-dlp", create_subprocess_exec
# lanza FileNotFoundError → "Error ejecutando yt-dlp".
import shutil
_VENV_YTDLP = BASE_DIR / "venv" / "bin" / "yt-dlp"
if _VENV_YTDLP.exists():
    YTDLP_BIN = str(_VENV_YTDLP)
else:
    _SYS_YTDLP = shutil.which("yt-dlp")
    YTDLP_BIN = _SYS_YTDLP or "yt-dlp"  # fallback al nombre, dejar que falle con mensaje claro

# yt-dlp flags compartidos
YTDLP_BASE_ARGS = [
    YTDLP_BIN,                                # ruta absoluta al binario del venv
    "-g",                                    # solo imprimir URL
    "--no-warnings",
    "--no-playlist",
    "--retries", "3",
    "--fragment-retries", "3",
    "--sleep-requests", "1",                 # 1s entre requests (suave)
    "--sleep-interval", "1",
    "--max-sleep-interval", "3",
    # Múltiples player clients en orden de prioridad.
    # Razón de cada uno:
    # - android_music: cliente YouTube Music Android → devuelve bestaudio
    #   (itag 140 m4a / 251 webm) sin PO token. Ideal.
    # - ios: cliente iOS → a veces devuelve audio-only sin PO token.
    # - android: cliente Android genérico → devuelve itag=18 video+audio.
    #   No es ideal pero el navegador reproduce el audio del mp4 igual.
    # - web: cliente web browser → requiere PO token para audio/video.
    #   Sin PO token solo entrega storyboards (imágenes). Último recurso.
    "--extractor-args", "youtube:player_client=android_music,ios,android,web",
]

# Añadir --cookies si está activado y el archivo existe
# (se evalúa en import time; si añades cookies después, reinicia el servicio)
if USE_COOKIES and COOKIES_PATH.exists():
    YTDLP_BASE_ARGS += ["--cookies", str(COOKIES_PATH)]
elif USE_COOKIES and not COOKIES_PATH.exists():
    # Lo avisamos en boot después de configurar logging
    pass

# ============================================================
# LOGGING
# ============================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    # Solo StreamHandler: systemd ya manda stdout/stderr a stream.log
    # via StandardOutput=append:stream.log. Si añadimos FileHandler,
    # cada linea se duplica en el archivo.
    handlers=[logging.StreamHandler()],
)
log = logging.getLogger("pi-stream")

# Aviso de cookies (post-logging para que se vea en el log)
if USE_COOKIES and COOKIES_PATH.exists():
    log.info(f"[boot] Cookies activadas desde {COOKIES_PATH}")
elif USE_COOKIES and not COOKIES_PATH.exists():
    log.warning(f"[boot] USE_COOKIES=true pero {COOKIES_PATH} no existe — ignorando cookies")
    # Quitar cualquier --cookies que se haya añadido por error
    YTDLP_BASE_ARGS = [a for a in YTDLP_BASE_ARGS if a != "--cookies"]
else:
    log.info("[boot] Cookies desactivadas (USE_COOKIES=false)")

# ============================================================
# DB
# ============================================================

def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS stream_cache (
            video_id   TEXT NOT NULL,
            quality    TEXT NOT NULL,
            url        TEXT NOT NULL,
            mime       TEXT,
            expire_ts  INTEGER NOT NULL,
            created_ts INTEGER NOT NULL,
            hits       INTEGER DEFAULT 0,
            PRIMARY KEY (video_id, quality)
        );
        CREATE INDEX IF NOT EXISTS idx_expire ON stream_cache(expire_ts);

        CREATE TABLE IF NOT EXISTS rate_log (
            ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rate_ts ON rate_log(ts);
    """)
    conn.commit()
    conn.close()

def db_conn():
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    return conn

def cache_get(video_id: str, quality: str) -> Optional[dict]:
    now = int(time.time())
    with db_conn() as c:
        row = c.execute(
            "SELECT * FROM stream_cache WHERE video_id=? AND quality=? AND expire_ts > ?",
            (video_id, quality, now + 600),  # margen 10 min
        ).fetchone()
        if row:
            c.execute(
                "UPDATE stream_cache SET hits = hits + 1 WHERE video_id=? AND quality=?",
                (video_id, quality),
            )
            c.commit()
            return dict(row)
    return None

def cache_put(video_id: str, quality: str, url: str, mime: str, ttl: int):
    now = int(time.time())
    with db_conn() as c:
        c.execute(
            "INSERT OR REPLACE INTO stream_cache (video_id, quality, url, mime, expire_ts, created_ts, hits) "
            "VALUES (?, ?, ?, ?, ?, ?, 0)",
            (video_id, quality, url, mime, now + ttl, now),
        )
        c.commit()

def cache_stats():
    now = int(time.time())
    with db_conn() as c:
        total = c.execute("SELECT COUNT(*) as n FROM stream_cache").fetchone()["n"]
        active = c.execute("SELECT COUNT(*) as n FROM stream_cache WHERE expire_ts > ?", (now,)).fetchone()["n"]
        hits = c.execute("SELECT COALESCE(SUM(hits),0) as n FROM stream_cache").fetchone()["n"]
        # requests en última hora
        recent = c.execute("SELECT COUNT(*) as n FROM rate_log WHERE ts > ?", (now - 3600,)).fetchone()["n"]
    return {"total_entries": total, "active_entries": active, "cache_hits": hits, "extractions_last_hour": recent}

def rate_log_add():
    now = int(time.time())
    with db_conn() as c:
        c.execute("INSERT INTO rate_log (ts) VALUES (?)", (now,))
        # limpiar viejos
        c.execute("DELETE FROM rate_log WHERE ts < ?", (now - 86400,))
        c.commit()

def rate_limit_ok() -> bool:
    now = int(time.time())
    with db_conn() as c:
        n = c.execute("SELECT COUNT(*) as n FROM rate_log WHERE ts > ?", (now - RATE_LIMIT_WINDOW,)).fetchone()["n"]
    return n < RATE_LIMIT_MAX

# ============================================================
# YT-DLP EXTRACTOR
# ============================================================

async def extract_stream_url(video_id: str, quality: str) -> dict:
    """
    Llama a yt-dlp -g para obtener la URL firmada de googlevideo.
    Devuelve {url, mime, format} o lanza excepción.
    """
    url = f"https://www.youtube.com/watch?v={video_id}"

    # Map quality → formato yt-dlp
    # IMPORTANTE: mantener el fallback /best porque según el player_client
    # que termine funcionando, bestaudio puede no estar disponible:
    #   - android_music/ios → suele dar bestaudio (itag 140/251)
    #   - android → solo da itag=18 (video+audio combined)
    #   - web sin PO token → solo storyboards (format error)
    # Con /best, si bestaudio falla, cae a itag=18 que igual reproduce
    # audio en el navegador (aunque baje video de regalo).
    if quality == "best":
        fmt = "bestaudio/best"
    elif quality == "128":
        fmt = "bestaudio[abr<=128]/bestaudio/best"
    elif quality == "192":
        fmt = "bestaudio/best"
    else:  # auto
        fmt = "bestaudio/best"

    args = YTDLP_BASE_ARGS + ["-f", fmt, url]

    if not rate_limit_ok():
        raise HTTPException(status_code=429, detail="Rate limit reached. Intenta en unos minutos.")

    log.info(f"[extract] video_id={video_id} quality={quality}")
    rate_log_add()

    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        # 60s de timeout. Antes era 20s, pero la primera extracción con
        # cookies + sleep-requests puede tardar 30-50s si YouTube está lento.
        # Cloudflare Tunnel tiene 30s default, así que subimos también
        # el proxy timeout del lado del túnel (configurar en CF dashboard).
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=60)
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except Exception:
            pass
        log.error(f"[extract] yt-dlp timeout tras 60s para {video_id}")
        raise HTTPException(status_code=504, detail="yt-dlp timeout (¿IP baneada o sin cookies?)")
    except FileNotFoundError as e:
        log.error(f"[extract] yt-dlp binario no encontrado: {YTDLP_BIN}")
        raise HTTPException(
            status_code=500,
            detail=f"yt-dlp no encontrado en '{YTDLP_BIN}'. Reinstala el venv o verifica la ruta.",
        )
    except Exception as e:
        log.error(f"[extract] subprocess error: {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail=f"Error ejecutando yt-dlp: {type(e).__name__}: {e}")

    if proc.returncode != 0:
        err = stderr.decode(errors="ignore").strip()
        log.error(f"[extract] yt-dlp failed rc={proc.returncode}: {err[:300]}")

        # DEBUG: si el error es de formato, listar los formatos disponibles
        # para que veamos qué tiene el video y podamos ajustar el -f
        if "format" in err.lower() or "not available" in err.lower():
            log.info("[extract] Listando formatos disponibles para debug:")
            try:
                list_args = [YTDLP_BIN, "--list-formats", url]
                if "--cookies" in YTDLP_BASE_ARGS:
                    idx = YTDLP_BASE_ARGS.index("--cookies")
                    list_args += ["--cookies", YTDLP_BASE_ARGS[idx + 1]]
                list_args += ["--extractor-args", "youtube:player_client=android_music,ios,android,web"]
                list_proc = await asyncio.create_subprocess_exec(
                    *list_args,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                list_stdout, _ = await asyncio.wait_for(list_proc.communicate(), timeout=30)
                list_text = list_stdout.decode(errors="ignore").strip()
                for line in list_text.splitlines():
                    log.info(f"[formats] {line}")
            except Exception as e:
                log.error(f"[extract] no se pudo listar formatos: {e}")

        if "Sign in to confirm" in err or "age" in err.lower():
            raise HTTPException(status_code=403, detail="YouTube requiere verificación (IP bajo sospecha)")
        raise HTTPException(status_code=502, detail=f"yt-dlp error: {err[:200]}")

    # yt-dlp -g imprime solo la URL (una o varias líneas).
    # Tomamos la primera línea válida que empiece con http.
    text = stdout.decode(errors="ignore").strip()
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    if not lines or not lines[0].startswith("http"):
        raise HTTPException(status_code=502, detail="yt-dlp no devolvió URL")
    stream_url = lines[0]

    # MIME: las URLs de googlevideo traen ?mime=audio%2Fwebm etc.
    mime = "audio/mpeg"
    if "googlevideo.com" in stream_url:
        try:
            from urllib.parse import urlparse, parse_qs, unquote
            q = parse_qs(urlparse(stream_url).query)
            m = q.get("mime", [None])[0]
            if m:
                mime = unquote(m)
        except Exception:
            pass

    log.info(f"[extract] OK mime={mime} url_len={len(stream_url)}")
    return {"url": stream_url, "mime": mime, "ext": "", "format_id": ""}

# ============================================================
# PASSTHROUGH PROXY
# ============================================================

async def stream_passthrough(upstream_url: str, range_header: Optional[str]):
    """
    Hace streaming HTTP del upstream (googlevideo) hacia el cliente.
    Soporta HTTP Range para que <audio> pueda seek.

    IMPORTANTE: usamos aiohttp (NO httpx). Razón:
    - httpx tiene un bug conocido con streaming 206 Partial Content a través
      de la cadena de redirects 302 de googlevideo (rr1→rr4). El stream
      arranca pero falla inmediatamente con 'ReadError' sin haber enviado
      ningún byte. Esto produce miles de reconexiones del navegador.
    - aiohttp maneja connection pooling + streaming + redirects de forma
      nativa y estable, específicamente diseñado para descargar media.
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        "Accept": "*/*",
        "Accept-Encoding": "identity",  # sin gzip, fundamental para stream
        "Connection": "keep-alive",
    }
    if range_header:
        headers["Range"] = range_header

    # Connector con keepalive para que los múltiples Range requests del
    # navegador reutilicen la misma conexión TCP a googlevideo.
    connector = aiohttp.TCPConnector(
        limit=20,
        limit_per_host=10,
        keepalive_timeout=60,
        enable_cleanup_closed=True,
    )
    timeout = aiohttp.ClientTimeout(
        total=None,          # sin timeout total (audio puede durar 1h+)
        connect=15,
        sock_connect=15,
        sock_read=300,       # 5 min sin datos = error (audio stuck)
    )

    session = aiohttp.ClientSession(
        connector=connector,
        timeout=timeout,
        auto_decompress=False,  # no decompress (ya pedimos identity)
    )

    try:
        upstream = await session.get(upstream_url, headers=headers, allow_redirects=True)

        if upstream.status >= 400:
            body = await upstream.read()
            log.warning(f"[passthrough] upstream {upstream.status}: {body[:200]}")
            await upstream.release()
            await session.close()
            raise HTTPException(status_code=upstream.status, detail="Upstream error")

        ct = upstream.headers.get("Content-Type", "audio/mpeg")
        cl = upstream.headers.get("Content-Length", "?")
        cr = upstream.headers.get("Content-Range", "")
        log.info(f"[passthrough] upstream {upstream.status} content-type={ct} len={cl} range={cr[:60]}")

        # Headers que pasamos al cliente
        pass_headers = {
            "Accept-Ranges": "bytes",
            "Content-Type": ct,
            "Cache-Control": "public, max-age=3600",
        }
        # Para 200 pasamos Content-Length. Para 206 pasamos Content-Range
        # (Content-Length en 206 = tamaño del chunk, no del archivo, y
        # starlette se queja si el stream se corta antes).
        if upstream.status == 200 and cl != "?":
            pass_headers["Content-Length"] = cl
        if cr:
            pass_headers["Content-Range"] = cr

        status = upstream.status

        async def gen():
            bytes_sent = 0
            try:
                # aiohttp iter_any lee lo que llegue sin bloquear.
                # chunk_size grande = menos overhead, mejor throughput.
                async for chunk in upstream.content.iter_any():
                    if not chunk:
                        continue
                    bytes_sent += len(chunk)
                    yield chunk
                log.info(f"[passthrough] stream done, sent {bytes_sent} bytes")
            except asyncio.CancelledError:
                log.info(f"[passthrough] client disconnected after {bytes_sent} bytes")
                raise
            except Exception as e:
                log.error(f"[passthrough] stream error after {bytes_sent} bytes: {type(e).__name__}: {e}")
            finally:
                upstream.release()
                await session.close()

        return StreamingResponse(
            gen(),
            status_code=status,
            headers=pass_headers,
            media_type=pass_headers["Content-Type"],
        )
    except HTTPException:
        raise
    except aiohttp.ClientConnectorError as e:
        log.error(f"[passthrough] connect error: {e}")
        await session.close()
        raise HTTPException(status_code=502, detail=f"No se pudo conectar a googlevideo: {e}")
    except asyncio.TimeoutError:
        log.error("[passthrough] connect timeout")
        await session.close()
        raise HTTPException(status_code=504, detail="googlevideo timeout")
    except Exception as e:
        log.error(f"[passthrough] error: {type(e).__name__}: {e}")
        await session.close()
        raise HTTPException(status_code=502, detail=f"Passthrough error: {type(e).__name__}")

# ============================================================
# APP
# ============================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    log.info(f"[boot] DB init @ {DB_PATH}")
    log.info(f"[boot] Cache TTL: {CACHE_TTL}s | Rate limit: {RATE_LIMIT_MAX}/{RATE_LIMIT_WINDOW}s")
    yield
    log.info("[shutdown] bye")

app = FastAPI(
    title="Pi Stream Backend",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Content-Length", "Accept-Ranges"],
)

@app.get("/health")
async def health():
    return {"status": "ok", "service": "pi-stream", "stats": cache_stats()}

@app.get("/info/{video_id}")
async def info(video_id: str, quality: str = "auto"):
    """Devuelve metadata sin descargar. Útil para pre-warming."""
    cached = cache_get(video_id, quality)
    if cached:
        return {"video_id": video_id, "quality": quality, "cached": True, "expire_ts": cached["expire_ts"]}
    return {"video_id": video_id, "quality": quality, "cached": False}

@app.get("/stream/{video_id}")
async def stream(
    video_id: str,
    request: Request,
    quality: str = Query("auto", pattern="^(auto|best|128|192)$"),
):
    """
    Endpoint principal. Devuelve el audio como stream HTTP.
    Cache hit: <50ms. Cache miss: 1-2s (yt-dlp).
    """
    # Validar formato del video_id
    # YouTube usa IDs de 11 caracteres en base64url: [A-Za-z0-9_-]
    # (NO usar .isalnum() porque rechaza '-' y '_' que son válidos)
    import re
    if not video_id or not re.match(r"^[A-Za-z0-9_-]{6,16}$", video_id):
        raise HTTPException(status_code=400, detail="video_id inválido")

    range_header = request.headers.get("range")

    # 1. Cache lookup
    cached = cache_get(video_id, quality)
    if cached:
        log.info(f"[stream] cache hit video_id={video_id} q={quality}")
        try:
            return await stream_passthrough(cached["url"], range_header)
        except HTTPException:
            # Si el cache falló (URL expiró o fue invalidada), re-extrae
            log.warning(f"[stream] cached URL failed for {video_id}, re-extracting")
        except Exception as e:
            log.error(f"[stream] cache passthrough error: {e}")

    # 2. Cache miss → extract
    extracted = await extract_stream_url(video_id, quality)
    cache_put(video_id, quality, extracted["url"], extracted["mime"], CACHE_TTL)

    # 3. Passthrough
    return await stream_passthrough(extracted["url"], range_header)

@app.post("/cache/expire")
async def cache_expire(video_id: str, quality: str = ""):
    """Invalida entradas del cache. Body: {video_id, quality?}"""
    with db_conn() as c:
        if quality:
            c.execute("DELETE FROM stream_cache WHERE video_id=? AND quality=?", (video_id, quality))
        else:
            c.execute("DELETE FROM stream_cache WHERE video_id=?", (video_id,))
        c.commit()
    return {"ok": True}

@app.exception_handler(HTTPException)
async def http_exc_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail, "path": str(request.url.path)},
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=LISTEN_PORT, log_level="info")
