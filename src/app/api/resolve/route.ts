import { NextRequest, NextResponse } from "next/server";

/**
 * API Route: /api/resolve?video_id=XXX&quality=auto|best|128|192
 *
 * Resuelve un video_id a una URL reproducible apuntando al backend
 * de la Pi 5 (que corre detrás de Cloudflare Tunnel).
 *
 * No hace fetch directo a YouTube desde el frontend — solo devuelve
 * la URL del stream-proxy de la Pi, que es la que el <audio> debe cargar.
 *
 * El backend de la Pi hace:
 *  1. Lookup en cache SQLite (TTL 5h)
 *  2. Si miss → yt-dlp -g para obtener URL firmada de googlevideo
 *  3. Reverse-proxy passthrough hacia googlevideo preservando la IP
 *
 * La URL que devolvemos aquí es:
 *   {PI_STREAM_BASE}/stream/{video_id}?quality={q}
 *
 * PI_STREAM_BASE se lee de variable de entorno para no harcoder el dominio.
 */

export async function GET(req: NextRequest) {
  const videoId = req.nextUrl.searchParams.get("video_id")?.trim();
  const quality = req.nextUrl.searchParams.get("quality") || "auto";

  if (!videoId) {
    return NextResponse.json(
      { error: "Falta video_id" },
      { status: 400 }
    );
  }

  const piBase = process.env.PI_STREAM_BASE;
  if (!piBase) {
    return NextResponse.json(
      { error: "Falta PI_STREAM_BASE en .env del frontend (ej: https://stream.tudominio.com)" },
      { status: 500 }
    );
  }

  // Construimos la URL final. El navegador la pondrá como <audio src>.
  const streamUrl = `${piBase.replace(/\/$/, "")}/stream/${encodeURIComponent(videoId)}?quality=${encodeURIComponent(quality)}`;

  return NextResponse.json({
    videoId,
    quality,
    streamUrl,
    // Metadatos para que el frontend muestre estado mientras carga
    note: "El audio comienza a sonar cuando la Pi resuelva la URL (cache hit <50ms, primer play 1-2s)",
  });
}
