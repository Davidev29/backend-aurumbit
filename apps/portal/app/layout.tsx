import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://aurumbit.com"),
  title: {
    default: "AurumBit — Sistemas sob medida e agentes IA para sua empresa",
    template: "%s | AurumBit",
  },
  description:
    "Desenvolvemos sistemas web, painéis, integrações e automações com a tecnologia certa para cada cliente — e treinamos agentes de IA especialistas no seu setor. Preço fechado antes de começar, sem taxa escondida.",
  keywords: [
    "programa para empresa",
    "funciona sem internet",
    "licença de software",
    "Pix boleto cartão",
    "AurumBit",
    "programa para loja",
    "programa para escritório",
  ],
  authors: [{ name: "AurumBit" }],
  creator: "AurumBit",
  publisher: "AurumBit",
  robots: "index, follow",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: "/",
    siteName: "AurumBit",
    title: "AurumBit — Sistemas sob medida e agentes IA para sua empresa",
    description:
      "Sistemas web, painéis e integrações com a tecnologia certa para cada cliente, mais agentes IA treinados na base da sua empresa.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "AurumBit - Programas para sua empresa",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AurumBit — Programas que funcionam sem internet",
    description: "Preço claro, Pix/boleto/cartão e ajuda em português.",
    images: ["/og-image.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F4ED" },
    { media: "(prefers-color-scheme: dark)", color: "#090806" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  colorScheme: "dark light",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/fundo-banner.jpg" as="image" type="image/jpeg" />
        {/* Anti-FOUC de tema: roda antes da primeira pintura, mesma chave ("theme")
            do next-themes; espelha .dark para o CSS legado e o variant dark:. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              '(function(){try{var s=localStorage.getItem("theme")||"system";var m=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";var t=s==="system"?m:s;if(t!=="light"&&t!=="dark")t="dark";var d=document.documentElement;d.dataset.theme=t;d.classList.toggle("dark",t==="dark");d.style.colorScheme=t;}catch(e){}})();',
          }}
        />
      </head>
      <body
        className="font-sans antialiased"
      >
        <a href="#main-content" className="skip-link">
          Pular para o conteúdo principal
        </a>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}