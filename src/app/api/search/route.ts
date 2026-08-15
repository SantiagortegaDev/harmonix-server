import { NextRequest, NextResponse } from "next/server";

/**
 * API Route: /api/search?q=<query>
 *
 * Busca canciones en YouTube usando la YouTube Data API v3.
 * La API key vive en el servidor (variable de entorno YOUTUBE_API_KEY),
 * nunca se expone al cliente. Esto permite:
 *  - Rotar la key sin redeploy del frontend
 *  - Restringir por IP del servidor (no por dominio del navegador)
 *  - Añadir cache server-side si hace falta
 */

const YT_API = "https://www.googleapis.com/youtube/v3/search";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json(
      { error: "Query vacío. Uso: /api/search?q=..." },
      { status: 400 }
    );
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Falta YOUTUBE_API_KEY en el servidor. Crea una en Google Cloud Console y añádela a .env",
      },
      { status: 500 }
    );
  }

  const url = new URL(YT_API);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("videoCategoryId", "10"); // música
  url.searchParams.set("maxResults", "25");
  url.searchParams.set("q", q);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("safeSearch", "none");
  url.searchParams.set("videoEmbeddable", "true");

  try {
    const res = await fetch(url, {
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[yt-search] upstream error", res.status, errText);
      return NextResponse.json(
        { error: `YouTube API respondió ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json();

    const items = (data.items || []).map((it: any) => ({
      videoId: it.id?.videoId,
      title: it.snippet?.title,
      channel: it.snippet?.channelTitle,
      thumbnail:
        it.snippet?.thumbnails?.medium?.url ||
        it.snippet?.thumbnails?.default?.url,
      publishedAt: it.snippet?.publishedAt,
    }));

    return NextResponse.json({
      query: q,
      total: items.length,
      items,
    });
  } catch (err) {
    console.error("[yt-search] fetch failed", err);
    return NextResponse.json(
      { error: "No se pudo conectar con YouTube" },
      { status: 502 }
    );
  }
}
