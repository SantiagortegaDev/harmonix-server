import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono-stack",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pi Stream — YouTube Music Player",
  description: "Streaming de YouTube Music ultra-rápido con caché en Raspberry Pi.",
  keywords: ["youtube", "music", "streaming", "raspberry pi", "yt-dlp"],
  authors: [{ name: "Pi Stream" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "Pi Stream",
    description: "Streaming de YouTube Music ultra-rápido con caché en Raspberry Pi.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* Color del browser chrome para MD3 mobile */}
        <meta name="theme-color" content="#6750A4" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#1B1B1F" media="(prefers-color-scheme: dark)" />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
