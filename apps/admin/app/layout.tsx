import type { Metadata, Viewport } from "next";
import "./globals.css";
import { MotionProvider } from "@/lib/motion";
import { ThemeProvider } from "@/lib/theme";
import { ToastProvider } from "@/lib/toast";
import { Toaster } from "@/components/ui/Toaster";

export const metadata: Metadata = {
  title: {
    default: "Aurum Admin — Aurum Bit",
    template: "%s · Aurum Admin",
  },
  description: "Terminal administrativo Aurum Bit — financeiro, cobranças e operação.",
  applicationName: "Aurum Admin",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/brand/logo.png", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/favicon.ico"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0d10" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark" data-theme="dark" suppressHydrationWarning>
      <body>
        <a href="#conteudo" className="skip-link">
          Pular para o conteúdo
        </a>
        <ThemeProvider>
          <MotionProvider>
            <ToastProvider>
              {children}
              <Toaster />
            </ToastProvider>
          </MotionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
