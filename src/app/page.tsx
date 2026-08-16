"use client";

import { useState, useRef, useEffect } from "react";
import { Search, Music2, Sun, Moon, Laptop, Loader2, Play, Pause, Volume2, VolumeX, Settings2, Radio, AlertCircle, Clock, Zap } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

type Track = {
  videoId: string;
  title: string;
  channel: string;
  thumbnail?: string;
  publishedAt?: string;
};

type Quality = "auto" | "best" | "128" | "192";

type Stats = {
  cacheHit?: boolean;
  latencyMs?: number;
  source?: string;
};

export default function Home() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loadingStream, setLoadingStream] = useState(false);
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [quality, setQuality] = useState<Quality>("auto");
  const [showSettings, setShowSettings] = useState(false);
  const [stats, setStats] = useState<Stats>({});

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // ---- Theme bootstrap ----
  useEffect(() => {
    setMounted(true);
  }, []);

  const cycleTheme = () => {
    const order: Array<"light" | "dark" | "system"> = ["light", "dark", "system"];
    const current = (theme as "light" | "dark" | "system") || "system";
    const idx = order.indexOf(current);
    const next = order[(idx + 1) % order.length];
    setTheme(next);
  };

  // ---- Búsqueda ----
  const doSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Error en la búsqueda");
        setResults([]);
        return;
      }
      const data = await res.json();
      setResults(data.items || []);
      if (!data.items?.length) {
        toast.info("Sin resultados para esa búsqueda");
        return;
      }

      // ===== PREFETCH en background =====
      // Disparar prefetch de los primeros 3 resultados para que cuando
      // el usuario haga click, la URL ya esté cacheada en la Pi → <50ms.
      // Fire-and-forget: no bloquea la UI, no muestra errores al usuario.
      const top3 = data.items.slice(0, 3);
      top3.forEach((track: Track, i: number) => {
        // Pequeño stagger para no saturar la Pi con 3 extracciones simultáneas
        setTimeout(() => {
          fetch(`/api/resolve?video_id=${track.videoId}&quality=auto&prefetch=1`)
            .then(() => console.log(`[prefetch] warmed ${track.videoId}`))
            .catch(() => {/* silent fail, prefetch es best-effort */});
        }, i * 400);
      });
    } catch (e) {
      toast.error("No se pudo conectar con el backend de búsqueda");
    } finally {
      setSearching(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSearch();
    }
  };

  // ---- Reproducción ----
  const playTrack = async (track: Track) => {
    setCurrentTrack(track);
    setIsPlaying(false);
    setLoadingStream(true);
    setStats({});

    try {
      const res = await fetch(`/api/resolve?video_id=${track.videoId}&quality=${quality}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "No se pudo resolver el stream");
        setLoadingStream(false);
        return;
      }
      const data = await res.json();

      // Log para debug — ver en consola del navegador qué URL se generó
      console.log("[pi-stream] resolve response:", data);

      // Validar que sea una URL absoluta con esquema http(s)
      if (!data.streamUrl || !/^https?:\/\//i.test(data.streamUrl)) {
        toast.error(
          `URL de stream inválida: "${data.streamUrl}". Revisa PI_STREAM_BASE en Vercel.`,
          { duration: 8000 }
        );
        setLoadingStream(false);
        return;
      }

      const audio = audioRef.current;
      if (!audio) return;

      // Pequeño hack: medir tiempo hasta primer byte de audio
      const t0 = performance.now();

      audio.src = data.streamUrl;
      audio.volume = muted ? 0 : volume;

      audio.addEventListener(
        "canplay",
        () => {
          const latency = Math.round(performance.now() - t0);
          setStats({ latencyMs: latency });
          setLoadingStream(false);
          audio.play().then(() => setIsPlaying(true)).catch(() => {});
        },
        { once: true }
      );

      audio.addEventListener(
        "error",
        () => {
          setLoadingStream(false);
          toast.error("El stream no se pudo cargar. ¿Está la Pi online?");
        },
        { once: true }
      );

      audio.load();
    } catch (e) {
      setLoadingStream(false);
      toast.error("Error inesperado al resolver el stream");
    }
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const onVolume = (v: number) => {
    setVolume(v);
    setMuted(v === 0);
    if (audioRef.current) audioRef.current.volume = v;
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    if (audioRef.current) audioRef.current.volume = next ? 0 : volume;
  };

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // No interceptar si está escribiendo en input
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "KeyM") {
        toggleMute();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- Render ----
  return (
    <div className="min-h-screen flex flex-col bg-[var(--md-bg)] text-[var(--md-on-bg)]">
      {/* ===== Top App Bar ===== */}
      <header className="sticky top-0 z-30 bg-[var(--md-surface)]/80 backdrop-blur-xl border-b border-[var(--md-outline-variant)]/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-[var(--md-primary-container)] flex items-center justify-center md-elevation-1">
              <Radio className="w-5 h-5 text-[var(--md-on-primary-container)]" strokeWidth={2.4} />
            </div>
            <div className="hidden sm:block">
              <div className="text-lg font-medium leading-tight">Pi Stream</div>
              <div className="text-xs text-[var(--md-on-surface-variant)] -mt-0.5">YouTube Music · Edge cached</div>
            </div>
          </div>

          {/* Search bar */}
          <div className="flex-1 max-w-2xl mx-auto">
            <div className="relative group">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--md-on-surface-variant)] group-focus-within:text-[var(--md-primary)] transition-colors">
                <Search className="w-5 h-5" />
              </div>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKey}
                placeholder="Busca canciones, artistas, álbumes…"
                className="w-full h-12 sm:h-14 pl-12 pr-4 rounded-full bg-[var(--md-surface-3)] border border-transparent focus:border-[var(--md-primary)] focus:bg-[var(--md-surface-4)] outline-none text-base transition-all placeholder:text-[var(--md-on-surface-variant)]/70"
                autoComplete="off"
                spellCheck={false}
              />
              {searching && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                  <Loader2 className="w-5 h-5 animate-spin text-[var(--md-primary)]" />
                </div>
              )}
            </div>
          </div>

          {/* Settings + Theme */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowSettings((s) => !s)}
              className="md-state-layer w-10 h-10 rounded-full flex items-center justify-center text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-variant)]/50 transition"
              aria-label="Configuración"
            >
              <Settings2 className="w-5 h-5" />
            </button>
            <button
              onClick={cycleTheme}
              className="md-state-layer w-10 h-10 rounded-full flex items-center justify-center text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-variant)]/50 transition"
              aria-label="Cambiar tema"
            >
              {!mounted ? (
                <Laptop className="w-5 h-5" />
              ) : theme === "light" ? (
                <Sun className="w-5 h-5" />
              ) : theme === "dark" ? (
                <Moon className="w-5 h-5" />
              ) : (
                <Laptop className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>

        {/* Settings panel */}
        {showSettings && (
          <div className="border-t border-[var(--md-outline-variant)]/50 bg-[var(--md-surface-1)] animate-fade-in">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-[var(--md-on-surface-variant)]">Calidad</label>
                <QualitySelector value={quality} onChange={setQuality} />
              </div>
              <div className="text-xs text-[var(--md-on-surface-variant)] flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-[var(--md-tertiary)]" />
                Auto = mejor calidad disponible (default)
              </div>
              <div className="ml-auto text-xs text-[var(--md-on-surface-variant)]">
                Atajos: <kbd className="px-1.5 py-0.5 rounded bg-[var(--md-surface-3)] font-mono">Space</kbd> play/pause · <kbd className="px-1.5 py-0.5 rounded bg-[var(--md-surface-3)] font-mono">M</kbd> mute
              </div>
            </div>
          </div>
        )}
      </header>

      {/* ===== Main content ===== */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 pb-32">
        {!searched ? (
          <Hero />
        ) : results.length === 0 && !searching ? (
          <EmptyState query={query} />
        ) : null}

        {results.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-medium">
                Resultados <span className="text-[var(--md-on-surface-variant)] text-base font-normal">· {results.length}</span>
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {results.map((t, i) => (
                <TrackCard
                  key={t.videoId}
                  track={t}
                  index={i}
                  isCurrent={currentTrack?.videoId === t.videoId}
                  isPlaying={isPlaying && currentTrack?.videoId === t.videoId}
                  loading={loadingStream && currentTrack?.videoId === t.videoId}
                  onPlay={() => playTrack(t)}
                />
              ))}
            </div>
          </section>
        )}
      </main>

      {/* ===== Bottom Player Bar ===== */}
      {currentTrack && (
        <PlayerBar
          track={currentTrack}
          isPlaying={isPlaying}
          loading={loadingStream}
          volume={volume}
          muted={muted}
          stats={stats}
          onTogglePlay={togglePlay}
          onVolume={onVolume}
          onMute={toggleMute}
        />
      )}

      <audio ref={audioRef} preload="auto" crossOrigin="anonymous" />
    </div>
  );
}

/* ====================================================================
   COMPONENTS
   ==================================================================== */

function Hero() {
  return (
    <section className="py-10 sm:py-16 flex flex-col items-center text-center animate-fade-in">
      <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-3xl bg-[var(--md-primary-container)] flex items-center justify-center md-elevation-3 mb-6">
        <Music2 className="w-10 h-10 sm:w-12 sm:h-12 text-[var(--md-on-primary-container)]" strokeWidth={1.8} />
      </div>
      <h1 className="text-3xl sm:text-5xl font-medium tracking-tight max-w-2xl">
        Tu música, al instante.
      </h1>
      <p className="text-base sm:text-lg text-[var(--md-on-surface-variant)] mt-4 max-w-xl">
        Streaming directo desde YouTube Music, cacheado en tu Raspberry Pi 5.
        Sin anuncios, sin esperar, sin bans.
      </p>
      <div className="grid grid-cols-3 gap-3 mt-10 w-full max-w-2xl">
        <Feature icon={<Zap className="w-5 h-5" />} title="<3s" subtitle="Primer audio" />
        <Feature icon={<Clock className="w-5 h-5" />} title="24h TTL" subtitle="Cache de URLs" />
        <Feature icon={<Radio className="w-5 h-5" />} title="Pi 5" subtitle="IP residencial" />
      </div>
    </section>
  );
}

function Feature({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="rounded-2xl bg-[var(--md-surface-1)] border border-[var(--md-outline-variant)]/40 p-4 flex flex-col items-center gap-1">
      <div className="text-[var(--md-primary)] mb-1">{icon}</div>
      <div className="text-lg font-medium">{title}</div>
      <div className="text-xs text-[var(--md-on-surface-variant)]">{subtitle}</div>
    </div>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="py-20 text-center animate-fade-in">
      <div className="w-16 h-16 rounded-full bg-[var(--md-surface-variant)] flex items-center justify-center mx-auto mb-4">
        <AlertCircle className="w-8 h-8 text-[var(--md-on-surface-variant)]" />
      </div>
      <h3 className="text-xl font-medium">Sin resultados</h3>
      <p className="text-[var(--md-on-surface-variant)] mt-2">
        No encontramos nada para &ldquo;{query}&rdquo;. Prueba con otro término.
      </p>
    </div>
  );
}

function TrackCard({
  track,
  index,
  isCurrent,
  isPlaying,
  loading,
  onPlay,
}: {
  track: Track;
  index: number;
  isCurrent: boolean;
  isPlaying: boolean;
  loading: boolean;
  onPlay: () => void;
}) {
  return (
    <button
      onClick={onPlay}
      style={{ animationDelay: `${Math.min(index * 25, 400)}ms` }}
      className={`md-state-layer text-left rounded-2xl overflow-hidden border transition-all animate-fade-in group ${
        isCurrent
          ? "bg-[var(--md-secondary-container)] border-[var(--md-primary)]"
          : "bg-[var(--md-surface-1)] border-[var(--md-outline-variant)]/40 hover:bg-[var(--md-surface-2)] hover:md-elevation-1"
      }`}
    >
      <div className="flex gap-3 p-3">
        <div className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-[var(--md-surface-variant)] flex-shrink-0">
          {track.thumbnail ? (
            <img
              src={track.thumbnail}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Music2 className="w-6 h-6 text-[var(--md-on-surface-variant)]" />
            </div>
          )}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            {loading ? (
              <Loader2 className="w-6 h-6 text-white animate-spin" />
            ) : isCurrent && isPlaying ? (
              <EqualizerIcon />
            ) : (
              <Play className="w-6 h-6 text-white" fill="currentColor" />
            )}
          </div>
        </div>
        <div className="flex-1 min-w-0 py-1">
          <div className={`font-medium text-sm sm:text-base line-clamp-2 ${isCurrent ? "text-[var(--md-on-secondary-container)]" : ""}`}>
            {track.title}
          </div>
          <div className={`text-xs sm:text-sm mt-1 truncate ${isCurrent ? "text-[var(--md-on-secondary-container)]/80" : "text-[var(--md-on-surface-variant)]"}`}>
            {track.channel}
          </div>
        </div>
      </div>
    </button>
  );
}

function EqualizerIcon() {
  return (
    <div className="flex items-end gap-0.5 h-6">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="w-1 bg-white rounded-full origin-bottom"
          style={{
            height: "100%",
            animation: `md-equalizer 0.8s ease-in-out ${i * 0.12}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

function PlayerBar({
  track,
  isPlaying,
  loading,
  volume,
  muted,
  stats,
  onTogglePlay,
  onVolume,
  onMute,
}: {
  track: Track;
  isPlaying: boolean;
  loading: boolean;
  volume: number;
  muted: boolean;
  stats: Stats;
  onTogglePlay: () => void;
  onVolume: (v: number) => void;
  onMute: () => void;
}) {
  return (
    <footer className="fixed bottom-0 inset-x-0 z-40 bg-[var(--md-surface-2)]/95 backdrop-blur-xl border-t border-[var(--md-outline-variant)]/50 md-elevation-3">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3 sm:gap-4">
        {/* Track info */}
        <div className="flex items-center gap-3 min-w-0 flex-1 sm:flex-none sm:w-72">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl overflow-hidden bg-[var(--md-surface-variant)] flex-shrink-0">
            {track.thumbnail ? (
              <img src={track.thumbnail} alt="" className="w-full h-full object-cover" />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-sm sm:text-base truncate">{track.title}</div>
            <div className="text-xs text-[var(--md-on-surface-variant)] truncate">{track.channel}</div>
          </div>
        </div>

        {/* Play controls */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={onTogglePlay}
            disabled={loading}
            className="md-state-layer w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] flex items-center justify-center disabled:opacity-50 hover:md-elevation-2 transition-shadow"
            aria-label={isPlaying ? "Pausar" : "Reproducir"}
          >
            {loading ? (
              <Loader2 className="w-5 h-5 sm:w-6 sm:h-6 animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" />
            ) : (
              <Play className="w-5 h-5 sm:w-6 sm:h-6 ml-0.5" fill="currentColor" />
            )}
          </button>
        </div>

        {/* Volume + stats */}
        <div className="hidden sm:flex items-center gap-3 flex-1 min-w-0">
          <button
            onClick={onMute}
            className="md-state-layer w-10 h-10 rounded-full flex items-center justify-center text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-variant)]/50"
            aria-label={muted ? "Activar sonido" : "Silenciar"}
          >
            {muted || volume === 0 ? (
              <VolumeX className="w-5 h-5" />
            ) : (
              <Volume2 className="w-5 h-5" />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => onVolume(parseFloat(e.target.value))}
            className="flex-1 max-w-32 accent-[var(--md-primary)]"
            aria-label="Volumen"
          />
          {stats.latencyMs !== undefined && (
            <div className="text-xs text-[var(--md-on-surface-variant)] flex items-center gap-1.5 flex-shrink-0">
              <span className={`w-2 h-2 rounded-full ${stats.latencyMs < 1000 ? "bg-emerald-500" : "bg-amber-500"}`} />
              {stats.latencyMs}ms
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}

function QualitySelector({ value, onChange }: { value: Quality; onChange: (q: Quality) => void }) {
  const opts: Array<{ id: Quality; label: string; desc: string }> = [
    { id: "auto", label: "Auto", desc: "Mejor calidad de YT" },
    { id: "best", label: "Mejor", desc: "bestaudio original" },
    { id: "128", label: "128 kbps", desc: "AAC fijo" },
    { id: "192", label: "192 kbps", desc: "MP3 re-codificado" },
  ];
  return (
    <div className="flex gap-1 bg-[var(--md-surface-3)] rounded-full p-1">
      {opts.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          title={o.desc}
          className={`md-state-layer px-3 sm:px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            value === o.id
              ? "bg-[var(--md-primary)] text-[var(--md-on-primary)]"
              : "text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
