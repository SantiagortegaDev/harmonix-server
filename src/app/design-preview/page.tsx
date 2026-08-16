"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { Play, Pause, Volume2, VolumeX, Search, Settings2, Music2, Radio, Zap, Clock, Loader2, Sun, Moon, Laptop, AlertCircle } from "lucide-react";

/**
 * Design Preview Page — /design-preview
 *
 * Muestra todos los componentes con el theme actual aplicado.
 * El diseñador usa esta página para iterar rápido en theme.css
 * sin tener que navegar la app real.
 */
export default function DesignPreview() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useState(() => setMounted(true));

  return (
    <div className="min-h-screen bg-[var(--md-bg)] text-[var(--md-on-bg)]">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[var(--md-surface)]/80 backdrop-blur-xl border-b border-[var(--md-outline-variant)]/50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-medium">Design Preview</h1>
            <p className="text-sm text-[var(--md-on-surface-variant)]">
              Edita <code className="px-1.5 py-0.5 rounded bg-[var(--md-surface-3)] font-mono text-xs">src/design/theme.css</code> y recarga
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setTheme("light")} className="md-state-layer w-10 h-10 rounded-full flex items-center justify-center hover:bg-[var(--md-surface-variant)]/50">
              <Sun className="w-5 h-5" />
            </button>
            <button onClick={() => setTheme("dark")} className="md-state-layer w-10 h-10 rounded-full flex items-center justify-center hover:bg-[var(--md-surface-variant)]/50">
              <Moon className="w-5 h-5" />
            </button>
            <button onClick={() => setTheme("system")} className="md-state-layer w-10 h-10 rounded-full flex items-center justify-center hover:bg-[var(--md-surface-variant)]/50">
              <Laptop className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-12">
        {/* Colors */}
        <Section title="Color Palette">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            <ColorSwatch name="Primary" varName="--md-primary" onVar="--md-on-primary" />
            <ColorSwatch name="Primary Container" varName="--md-primary-container" onVar="--md-on-primary-container" />
            <ColorSwatch name="Secondary" varName="--md-secondary" onVar="--md-on-secondary" />
            <ColorSwatch name="Secondary Container" varName="--md-secondary-container" onVar="--md-on-secondary-container" />
            <ColorSwatch name="Tertiary" varName="--md-tertiary" onVar="--md-on-tertiary" />
            <ColorSwatch name="Tertiary Container" varName="--md-tertiary-container" onVar="--md-on-tertiary-container" />
            <ColorSwatch name="Error" varName="--md-error" onVar="--md-on-error" />
            <ColorSwatch name="Error Container" varName="--md-error-container" onVar="--md-on-error-container" />
            <ColorSwatch name="Surface" varName="--md-surface" onVar="--md-on-surface" />
            <ColorSwatch name="Surface 1" varName="--md-surface-1" onVar="--md-on-surface" />
            <ColorSwatch name="Surface 2" varName="--md-surface-2" onVar="--md-on-surface" />
            <ColorSwatch name="Surface 3" varName="--md-surface-3" onVar="--md-on-surface" />
            <ColorSwatch name="Surface Variant" varName="--md-surface-variant" onVar="--md-on-surface-variant" />
            <ColorSwatch name="Outline" varName="--md-outline" onVar="--md-on-surface" />
            <ColorSwatch name="Outline Variant" varName="--md-outline-variant" onVar="--md-on-surface" />
          </div>
        </Section>

        {/* Typography */}
        <Section title="Typography">
          <div className="space-y-3 bg-[var(--md-surface-1)] rounded-2xl p-6 border border-[var(--md-outline-variant)]/40">
            <h1 className="text-5xl font-medium tracking-tight">Heading 1 — Tu música, al instante.</h1>
            <h2 className="text-3xl font-medium">Heading 2 — Resultados</h2>
            <h3 className="text-xl font-medium">Heading 3 — Card title</h3>
            <p className="text-base">Body text — Streaming directo desde YouTube Music, cacheado en tu Raspberry Pi 5.</p>
            <p className="text-sm text-[var(--md-on-surface-variant)]">Caption / helper text — 24h TTL cache</p>
            <code className="block px-3 py-2 rounded-lg bg-[var(--md-surface-3)] font-mono text-sm">code block — pi-stream.log</code>
          </div>
        </Section>

        {/* Buttons */}
        <Section title="Buttons">
          <div className="flex flex-wrap gap-3">
            <button className="md-state-layer px-6 py-3 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] font-medium hover:md-elevation-2 transition-shadow">
              Primary Action
            </button>
            <button className="md-state-layer px-6 py-3 rounded-full bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)] font-medium">
              Secondary
            </button>
            <button className="md-state-layer px-6 py-3 rounded-full bg-[var(--md-surface-3)] text-[var(--md-on-surface)] font-medium">
              Tonal
            </button>
            <button className="md-state-layer px-6 py-3 rounded-full border border-[var(--md-outline)] text-[var(--md-primary)] font-medium">
              Outlined
            </button>
            <button className="md-state-layer px-6 py-3 rounded-full text-[var(--md-primary)] font-medium">
              Text
            </button>
            <button className="md-state-layer w-12 h-12 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] flex items-center justify-center hover:md-elevation-2">
              <Play className="w-5 h-5" fill="currentColor" />
            </button>
            <button className="md-state-layer w-12 h-12 rounded-full bg-[var(--md-error)] text-[var(--md-on-error)] flex items-center justify-center">
              <AlertCircle className="w-5 h-5" />
            </button>
            <button disabled className="md-state-layer px-6 py-3 rounded-full bg-[var(--md-surface-3)] text-[var(--md-on-surface-variant)] font-medium opacity-50">
              Disabled
            </button>
          </div>
        </Section>

        {/* Cards */}
        <Section title="Cards & Elevation">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="rounded-2xl bg-[var(--md-surface-1)] border border-[var(--md-outline-variant)]/40 p-4">
              <div className="text-xs text-[var(--md-on-surface-variant)] mb-1">Surface 1 · No elevation</div>
              <div className="font-medium">Card Title</div>
              <p className="text-sm text-[var(--md-on-surface-variant)] mt-1">Card description goes here.</p>
            </div>
            <div className="rounded-2xl bg-[var(--md-surface-2)] border border-[var(--md-outline-variant)]/40 p-4 md-elevation-1">
              <div className="text-xs text-[var(--md-on-surface-variant)] mb-1">Surface 2 · Elevation 1</div>
              <div className="font-medium">Card Title</div>
              <p className="text-sm text-[var(--md-on-surface-variant)] mt-1">Card description goes here.</p>
            </div>
            <div className="rounded-2xl bg-[var(--md-surface-3)] border border-[var(--md-outline-variant)]/40 p-4 md-elevation-3">
              <div className="text-xs text-[var(--md-on-surface-variant)] mb-1">Surface 3 · Elevation 3</div>
              <div className="font-medium">Card Title</div>
              <p className="text-sm text-[var(--md-on-surface-variant)] mt-1">Card description goes here.</p>
            </div>
          </div>
        </Section>

        {/* Track Card (real component preview) */}
        <Section title="Track Card (real component)">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-4xl">
            <button className="md-state-layer text-left rounded-2xl overflow-hidden border bg-[var(--md-surface-1)] border-[var(--md-outline-variant)]/40 hover:bg-[var(--md-surface-2)] hover:md-elevation-1 transition-all group">
              <div className="flex gap-3 p-3">
                <div className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-[var(--md-surface-variant)] flex-shrink-0">
                  <div className="w-full h-full flex items-center justify-center">
                    <Music2 className="w-6 h-6 text-[var(--md-on-surface-variant)]" />
                  </div>
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Play className="w-6 h-6 text-white" fill="currentColor" />
                  </div>
                </div>
                <div className="flex-1 min-w-0 py-1">
                  <div className="font-medium text-sm sm:text-base line-clamp-2">Never Gonna Give You Up</div>
                  <div className="text-xs sm:text-sm mt-1 truncate text-[var(--md-on-surface-variant)]">Rick Astley</div>
                </div>
              </div>
            </button>

            <button className="md-state-layer text-left rounded-2xl overflow-hidden border bg-[var(--md-secondary-container)] border-[var(--md-primary)]">
              <div className="flex gap-3 p-3">
                <div className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-[var(--md-surface-variant)] flex-shrink-0">
                  <div className="w-full h-full flex items-center justify-center">
                    <Music2 className="w-6 h-6 text-[var(--md-on-surface-variant)]" />
                  </div>
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <div className="flex items-end gap-0.5 h-6">
                      {[0, 1, 2, 3].map((i) => (
                        <span key={i} className="w-1 bg-white rounded-full origin-bottom" style={{ height: "100%", animation: `md-equalizer 0.8s ease-in-out ${i * 0.12}s infinite` }} />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex-1 min-w-0 py-1">
                  <div className="font-medium text-sm sm:text-base line-clamp-2 text-[var(--md-on-secondary-container)]">Blinding Lights</div>
                  <div className="text-xs sm:text-sm mt-1 truncate text-[var(--md-on-secondary-container)]/80">The Weeknd</div>
                </div>
              </div>
            </button>
          </div>
        </Section>

        {/* Player Bar (real component preview) */}
        <Section title="Player Bar (real component)">
          <div className="bg-[var(--md-surface-2)]/95 backdrop-blur-xl border-t border-[var(--md-outline-variant)]/50 md-elevation-3 rounded-2xl">
            <div className="px-4 sm:px-6 py-3 flex items-center gap-3 sm:gap-4">
              <div className="flex items-center gap-3 min-w-0 flex-1 sm:flex-none sm:w-72">
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl overflow-hidden bg-[var(--md-surface-variant)] flex-shrink-0 flex items-center justify-center">
                  <Music2 className="w-5 h-5 text-[var(--md-on-surface-variant)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm sm:text-base truncate">Currently Playing Track</div>
                  <div className="text-xs text-[var(--md-on-surface-variant)] truncate">Artist Name</div>
                </div>
              </div>
              <div className="flex items-center gap-2 sm:gap-3">
                <button className="md-state-layer w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] flex items-center justify-center hover:md-elevation-2">
                  <Pause className="w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" />
                </button>
              </div>
              <div className="hidden sm:flex items-center gap-3 flex-1 min-w-0">
                <button className="md-state-layer w-10 h-10 rounded-full flex items-center justify-center text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-variant)]/50">
                  <Volume2 className="w-5 h-5" />
                </button>
                <input type="range" min={0} max={1} step={0.01} defaultValue={0.85} className="flex-1 max-w-32 accent-[var(--md-primary)]" />
                <div className="text-xs text-[var(--md-on-surface-variant)] flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  85ms
                </div>
              </div>
            </div>
          </div>
        </Section>

        {/* Input */}
        <Section title="Inputs">
          <div className="space-y-4 max-w-md">
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--md-on-surface-variant)]">
                <Search className="w-5 h-5" />
              </div>
              <input
                type="text"
                placeholder="Busca canciones…"
                className="w-full h-12 sm:h-14 pl-12 pr-4 rounded-full bg-[var(--md-surface-3)] border border-transparent focus:border-[var(--md-primary)] focus:bg-[var(--md-surface-4)] outline-none text-base transition-all"
              />
            </div>
            <input
              type="text"
              placeholder="Outlined input"
              className="w-full h-12 px-4 rounded-xl bg-transparent border border-[var(--md-outline)] focus:border-[var(--md-primary)] outline-none"
            />
          </div>
        </Section>

        {/* Chips */}
        <Section title="Chips & Badges">
          <div className="flex flex-wrap gap-2">
            {["Auto", "Mejor", "128 kbps", "192 kbps"].map((label, i) => (
              <button
                key={label}
                className={`md-state-layer px-4 py-1.5 rounded-full text-sm font-medium ${
                  i === 0
                    ? "bg-[var(--md-primary)] text-[var(--md-on-primary)]"
                    : "bg-[var(--md-surface-3)] text-[var(--md-on-surface-variant)]"
                }`}
              >
                {label}
              </button>
            ))}
            <span className="px-3 py-1 rounded-full bg-[var(--md-error-container)] text-[var(--md-on-error-container)] text-xs font-medium">
              Error
            </span>
            <span className="px-3 py-1 rounded-full bg-[var(--md-tertiary-container)] text-[var(--md-on-tertiary-container)] text-xs font-medium">
              New
            </span>
          </div>
        </Section>

        {/* Icons */}
        <Section title="Icons (lucide-react)">
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-4">
            {[Play, Pause, Volume2, VolumeX, Search, Settings2, Music2, Radio, Zap, Clock, Loader2, AlertCircle, Sun, Moon, Laptop].map((Icon, i) => (
              <div key={i} className="aspect-square rounded-xl bg-[var(--md-surface-1)] border border-[var(--md-outline-variant)]/40 flex items-center justify-center">
                <Icon className="w-6 h-6 text-[var(--md-on-surface-variant)]" />
              </div>
            ))}
          </div>
        </Section>

        {/* Radii */}
        <Section title="Border Radii">
          <div className="flex flex-wrap items-end gap-4">
            {[
              { name: "sm", val: "var(--radius-sm)" },
              { name: "md", val: "var(--radius-md)" },
              { name: "lg", val: "var(--radius-lg)" },
              { name: "xl", val: "var(--radius-xl)" },
            ].map((r) => (
              <div key={r.name} className="text-center">
                <div className="w-20 h-20 bg-[var(--md-primary-container)] border border-[var(--md-outline-variant)]/40 mb-2" style={{ borderRadius: r.val }} />
                <div className="text-xs text-[var(--md-on-surface-variant)]">{r.name}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* Elevation */}
        <Section title="Elevation (Shadows)">
          <div className="flex flex-wrap gap-6">
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className="text-center">
                <div className={`w-24 h-24 rounded-2xl bg-[var(--md-surface-1)] border border-[var(--md-outline-variant)]/40 mb-2 md-elevation-${n}`} />
                <div className="text-xs text-[var(--md-on-surface-variant)]">elevation-{n}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* Footer */}
        <div className="border-t border-[var(--md-outline-variant)]/40 pt-6 pb-12 text-center text-sm text-[var(--md-on-surface-variant)]">
          Harmonix Design System · Edita <code className="px-1.5 py-0.5 rounded bg-[var(--md-surface-3)] font-mono text-xs">src/design/theme.css</code> para cambiar el theme
        </div>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-medium mb-4 text-[var(--md-on-surface-variant)]">{title}</h2>
      {children}
    </section>
  );
}

function ColorSwatch({ name, varName, onVar }: { name: string; varName: string; onVar: string }) {
  return (
    <div className="rounded-xl overflow-hidden border border-[var(--md-outline-variant)]/40">
      <div className="h-20 flex items-center justify-center" style={{ background: `var(${varName})` }}>
        <span className="text-xs font-medium" style={{ color: `var(${onVar})` }}>Aa</span>
      </div>
      <div className="p-2 bg-[var(--md-surface-1)]">
        <div className="text-xs font-medium truncate">{name}</div>
        <div className="text-[10px] text-[var(--md-on-surface-variant)] font-mono truncate">{varName}</div>
      </div>
    </div>
  );
}
