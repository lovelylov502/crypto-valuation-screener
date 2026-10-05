import type { Metadata, Viewport } from "next";
import { BRAND } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(BRAND.url),
  applicationName: BRAND.name,
  title: `${BRAND.name} ${BRAND.koreanName} | ${BRAND.tagline}`,
  description: BRAND.description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: "/",
    siteName: BRAND.name,
    title: `${BRAND.name} · ${BRAND.tagline}`,
    description: BRAND.description,
    images: [{ url: "/brand/tovenit-social.png", width: 1200, height: 630, alt: `${BRAND.name} — ${BRAND.tagline}` }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${BRAND.name} · ${BRAND.tagline}`,
    description: BRAND.description,
    images: ["/brand/tovenit-social.png"],
  },
  appleWebApp: { title: BRAND.name },
};

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f6f7f3" }, { media: "(prefers-color-scheme: dark)", color: "#181a19" }],
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: `(function(){var t;try{t=localStorage.getItem('tovenit-theme')}catch(e){}document.documentElement.dataset.theme=t==='light'||t==='dark'?t:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'})()` }}/></head>
      <body>{children}</body>
    </html>
  );
}
