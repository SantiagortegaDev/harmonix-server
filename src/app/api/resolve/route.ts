import { NextRequest, NextResponse } from "next/server";

/**
 * API Route: /api/resolve?video_id=XXX&quality=auto|best|128|192&prefetch=0|1
 *
 * Resuelve un video_id a una URL reproducible apuntando al backend
 * de la Pi 5 (que corre detrás de Cloudflare Tunnel).
 *
 * Modo normal (sin prefetch): devuelve {PI_STREAM_BASE}/stream/{video_id}
 *   → el <audio> carga directo de la Pi, que hace passthrough a googlevideo.
 *
 * Modo prefetch (prefetch=1): devuelve la URL /prefetch/{video_id} de la Pi.
 *   → la Pi extrae y cachea la URL, pero NO hace streaming.
 *   → cuando el usuario haga click, /stream/{video_id} será cache hit → <50ms.
 *   → el frontend lo llama fire-and-forget al mostrar resultados de búsqueda.
 */

export async function GET(req: NextRequest) {
  const videoId = req.nextUrl.searchParams.get("video_id")?.trim();
  const quality = req.nextUrl.searchParams.get("quality") || "auto";
  const isPrefetch = req.nextUrl.searchParams.get("prefetch") === "1";

  if (!videoId) {
    return NextResponse.json(
      { error: "Falta video_id" },
      { status: 400 }
    );
  }

  let piBase = process.env.PI_STREAM_BASE?.trim();
  if (!piBase) {
    return NextResponse.json(
      {
        error:
          "Falta PI_STREAM_BASE en variables de entorno de Vercel. Va a: Vercel → Project → Settings → Environment Variables. Valor esperado: https://api-stream-harmonix.santiagortega.dev (CON https://)",
        hint: "Sin el esquema https:// el navegador trata el dominio como path relativo.",
      },
      { status: 500 }
    );
  }

  // Normalizar: si no empieza con http:// o https://, agregar https://
  if (!/^https?:\/\//i.test(piBase)) {
    piBase = `https://${piBase}`;
  }
  piBase = piBase.replace(/\/$/, "");

  // En modo prefetch, llamamos al endpoint /prefetch de la Pi que calienta
  // el cache sin hacer streaming. Devuelve JSON, no audio.
  if (isPrefetch) {
    const prefetchUrl = `${piBase}/prefetch/${encodeURIComponent(videoId)}?quality=${encodeURIComponent(quality)}`;
    try {
      const piRes = await fetch(prefetchUrl, {
        // Timeout generoso: la extracción puede tardar 3-5s la primera vez
        signal: AbortSignal.timeout(15000),
      });
      const data = await piRes.json().catch(() => ({}));
      return NextResponse.json({
        videoId,
        quality,
        prefetch: true,
        status: data.status || "unknown",
        ok: data.ok === true,
      });
    } catch (e) {
      // Prefetch es best-effort, no propagar error al frontend
      return NextResponse.json({
        videoId,
        quality,
        prefetch: true,
        status: "failed",
        ok: false,
      });
    }
  }

  // Modo normal: devolver la URL de /stream para que el <audio> la cargue
  const streamUrl = `${piBase}/stream/${encodeURIComponent(videoId)}?quality=${encodeURIComponent(quality)}`;

  return NextResponse.json({
    videoId,
    quality,
    streamUrl,
    note: "El audio comienza a sonar cuando la Pi resuelva la URL (cache hit <50ms, primer play 1-2s)",
  });
}
