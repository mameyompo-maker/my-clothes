import type { Metadata, Viewport } from "next";
import { Inter, Jost, Playfair_Display } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { AppShell } from "@/components/AppShell";

/**
 * 参照デザイン(fashion_cheeful.pptx)は Futura / Aileron / Perandory Condensed で
 * 組まれているが、いずれもWebフォントとして配布できない。雰囲気の近いものに置き換える。
 * 日本語はWebフォントを読み込むと数MBになるので、端末のゴシックに任せている。
 */
const display = Jost({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const body = Inter({
  variable: "--font-body",
  subsets: ["latin"],
});

const editorial = Playfair_Display({
  variable: "--font-editorial",
  subsets: ["latin"],
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: "My Clothes",
  description: "朝のコーデ選びを、友達と一緒に。",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "My Clothes",
  },
};

export const viewport: Viewport = {
  themeColor: "#d9d9d9",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${body.variable} ${display.variable} ${editorial.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
