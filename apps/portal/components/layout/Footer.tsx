"use client";

import Link from "next/link";
import { Globe, Mail, ArrowUpRight, MessageCircle, Send } from "lucide-react";
import { Logo } from "@/components/ui";
import { COMPANY } from "@/lib/company";
import { scrollToTop, scrollToSelector } from "@/lib/scroll";

interface FooterLink {
  label: string;
  href: string;
}

interface FooterColumn {
  title: string;
  key: string;
  links: FooterLink[];
}

const SUPPORT_EMAIL = "contato@aurumbit.com";

const columns: FooterColumn[] = [
  {
    title: "Produto",
    key: "produto",
    links: [
      { href: "#produtos", label: "Planos e preços" },
      { href: "#como-funciona", label: "Como funciona" },
      { href: "#servicos", label: "Serviços sob medida" },
    ],
  },
  {
    title: "Empresa",
    key: "empresa",
    links: [
      { href: "#solucoes", label: "Para a sua empresa" },
      { href: "#faq", label: "Dúvidas" },
      { href: `mailto:${SUPPORT_EMAIL}`, label: "Falar com atendimento" },
    ],
  },
  {
    title: "Ajuda",
    key: "ajuda",
    links: [
      { href: "#produtos", label: "Ver programas e preços" },
      { href: "#faq", label: "Dúvidas" },
      { href: `mailto:${SUPPORT_EMAIL}`, label: "Falar com atendimento" },
    ],
  },
  {
    title: "Legal",
    key: "legal",
    links: [
      { href: "#faq", label: "Seus dados e a LGPD" },
      { href: "#produtos", label: "Preços e condições" },
      { href: `mailto:${SUPPORT_EMAIL}?subject=Privacidade%20e%20LGPD`, label: "Falar sobre privacidade" },
    ],
  },
];

const socialLinks = [
  { href: COMPANY.site, label: "Site", icon: Globe },
  { href: COMPANY.telegram, label: "Telegram", icon: Send },
  ...(COMPANY.whatsapp
    ? [{ href: COMPANY.whatsapp, label: "WhatsApp", icon: MessageCircle }]
    : []),
  { href: `mailto:${COMPANY.email}`, label: "E-mail", icon: Mail },
];

const linkClassName =
  "rounded-sm text-body text-text2 transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function Footer() {
  const goToTop = (e: React.MouseEvent) => {
    e.preventDefault();
    scrollToTop();
  };

  const goToSection = (href: string) => (e: React.MouseEvent) => {
    if (!href.startsWith("#")) return;
    e.preventDefault();
    scrollToSelector(href);
  };

  return (
    <footer className="border-t border-line2 bg-bg0">
      <div className="container-portal py-12 sm:py-16 lg:py-20">
        <div className="grid gap-10 sm:grid-cols-2 sm:gap-12 lg:grid-cols-6">
          {/* Brand */}
          <div className="space-y-6 sm:col-span-2 lg:col-span-2">
            <Link
              href="/"
              onClick={goToTop}
              className="inline-flex items-center gap-2 rounded-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="AurumBit - Voltar ao início"
            >
              <Logo size="md" />
            </Link>
            <p className="max-w-xs text-body text-text2">
              Programas prontos para a sua empresa, que continuam funcionando mesmo sem internet.
              Pagamento do jeito que você prefere e ajuda em português.
            </p>
            <div className="space-y-1 text-caption text-text2">
              <p>Pagamento seguro: Pix, boleto ou cartão.</p>
              <p>Dados tratados com cuidado, seguindo a lei de proteção de dados (LGPD).</p>
            </div>
            <div className="flex items-center gap-2">
              {socialLinks.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-base text-text2 transition-colors hover:bg-bg2 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  aria-label={social.label}
                >
                  <social.icon className="h-5 w-5" aria-hidden="true" />
                </a>
              ))}
            </div>
          </div>

          {/* Link columns */}
          {columns.map((column) => (
            <nav key={column.key} aria-label={`Links de ${column.title.toLowerCase()}`} className="min-w-0">
              <h3 className="mb-4 font-display font-semibold text-text1">{column.title}</h3>
              <ul className="space-y-3" role="list">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {link.href.startsWith("mailto:") ? (
                      <a href={link.href} className={linkClassName}>
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        onClick={goToSection(link.href)}
                        className={linkClassName}
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-line2 pt-8 sm:mt-12 sm:flex-row">
          <p className="text-center text-caption text-text2 sm:text-left">
            © {new Date().getFullYear()} AurumBit. Todos os direitos reservados.
          </p>
          <div className="flex items-center gap-6 text-caption text-text2">
            <span>Feito no Brasil</span>
            <a
              href="#hero"
              onClick={goToTop}
              className="flex min-h-[44px] min-w-[44px] items-center gap-1 rounded-sm text-text2 transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="Voltar ao topo"
            >
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              Topo
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
