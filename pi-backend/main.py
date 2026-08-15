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
from urllib.parse import urlparse

import httpx
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

# yt-dlp flags compartidos
YTDLP_BASE_ARGS = [
    "yt-dlp",
    "-g",                                    # solo imprimir URL
    "--no-warnings",
    "--no-playlist",
    "--retries", "3",
    "--fragment-retries", "3",
    "--sleep-requests", "1",                 # 1s entre requests (suave)
    "--sleep-interval", "1",
    "--max-sleep-interval", "3",
    "--extractor-args", "youtube:player_client=mweb",  # cliente móvil, más estable
]

# ============================================================
# LOGGING
# ============================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOG_PATH),
    ],
)
log = logging.getLogger("pi-stream")

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
    if quality == "best":
        fmt = "bestaudio/best"
    elif quality == "128":
        fmt = "bestaudio[abr<=128]/bestaudio/best"
    elif quality == "192":
        # Para 192 necesitamos re-codificar → lo dejamos para el passthrough ffmpeg
        # Aquí extraemos bestaudio, el reencode va en el proxy
        fmt = "bestaudio/best"
    else:  # auto
        fmt = "bestaudio/best"

    args = YTDLP_BASE_ARGS + ["-f", fmt, "--print", "%(ext)s|%(format_id)s", url]

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
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=20)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="yt-dlp timeout (¿IP baneada?)")
    except Exception as e:
        log.error(f"[extract] subprocess error: {e}")
        raise HTTPException(status_code=500, detail="Error ejecutando yt-dlp")

    if proc.returncode != 0:
        err = stderr.decode(errors="ignore").strip()
        log.error(f"[extract] yt-dlp failed rc={proc.returncode}: {err[:300]}")
        if "Sign in to confirm" in err or "age" in err.lower():
            raise HTTPException(status_code=403, detail="YouTube requiere verificación (IP bajo sospecha)")
        raise HTTPException(status_code=502, detail=f"yt-dlp error: {err[:200]}")

    # yt-dlp con --print devuelve: URL\n(ext|format_id)
    text = stdout.decode(errors="ignore").strip()
    lines = text.split("\n")
    if len(lines) < 2 or not lines[0]:
        raise HTTPException(status_code=502, detail="yt-dlp no devolvió URL")
    stream_url = lines[0].strip()
    meta = lines[1].split("|") if len(lines) > 1 else ["", ""]
    ext = meta[0] if meta else ""
    fmt_id = meta[1] if len(meta) > 1 else ""

    # MIME por extensión
    mime_map = {"webm": "audio/webm", "m4a": "audio/mp4", "mp4": "audio/mp4", "ogg": "audio/ogg", "opus": "audio/ogg"}
    mime = mime_map.get(ext.lower(), "audio/mpeg")

    log.info(f"[extract] OK ext={ext} fmt={fmt_id} url_len={len(stream_url)}")
    return {"url": stream_url, "mime": mime, "ext": ext, "format_id": fmt_id}

# ============================================================
# PASSTHROUGH PROXY
# ============================================================

async def stream_passthrough(upstream_url: str, range_header: Optional[str]):
    """
    Hace streaming HTTP del upstream (googlevideo) hacia el cliente.
    Soporta HTTP Range para que <audio> pueda seek.
    """
    headers = {}
    if range_header:
        headers["Range"] = range_header
    # UA mínimo para no levantar sospechas
    headers["User-Agent"] = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"

    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0), follow_redirects=True) as client:
        async with client.stream("GET", upstream_url, headers=headers) as upstream:
            if upstream.status_code >= 400:
                body = await upstream.aread()
                log.warning(f"[passthrough] upstream {upstream.status_code}: {body[:200]}")
                raise HTTPException(status_code=upstream.status_code, detail="Upstream error")

            # Headers que pasamos al cliente
            pass_headers = {
                "Accept-Ranges": "bytes",
                "Content-Type": upstream.headers.get("content-type", "audio/mpeg"),
            }
            if "content-length" in upstream.headers:
                pass_headers["Content-Length"] = upstream.headers["content-length"]
            if "content-range" in upstream.headers:
                pass_headers["Content-Range"] = upstream.headers["content-range"]

            status = upstream.status_code

            async def gen():
                try:
                    async for chunk in upstream.aiter_bytes(chunk_size=64 * 1024):
                        yield chunk
                except Exception as e:
                    log.error(f"[passthrough] stream error: {e}")

            return StreamingResponse(
                gen(),
                status_code=status,
                headers=pass_headers,
                media_type=pass_headers["Content-Type"],
            )

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
    quality: str = Query("auto", regex="^(auto|best|128|192)$"),
):
    """
    Endpoint principal. Devuelve el audio como stream HTTP.
    Cache hit: <50ms. Cache miss: 1-2s (yt-dlp).
    """
    # Validar formato del video_id
    if not video_id or len(video_id) > 16 or not video_id.isalnum():
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
