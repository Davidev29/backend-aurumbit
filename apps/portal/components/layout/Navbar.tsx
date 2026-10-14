"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { scrollToSelector } from "@/lib/scroll";
import { Button, Logo } from "@/components/ui";
import { ThemeToggle } from "./ThemeToggle";
import { useAuth } from "@/hooks/useAuth";
import { usePortal } from "@/lib/portal-context";

const navLinks = [
  { href: "#produtos", label: "Produtos" },
  { href: "#solucoes", label: "Soluções" },
  { href: "#como-funciona", label: "Como funciona" },
  { href: "#servicos", label: "Serviços" },
  { href: "#ia-especialistas", label: "IA Especialista" },
  { href: "#custo-beneficio", label: "Custo-benefício" },
  { href: "#faq", label: "Dúvidas" },
];

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [activeSection, setActiveSection] = useState<string>("#produtos");
  const { user, logout } = useAuth();
  const { openAuthModal } = usePortal();
  const router = useRouter();

  const handleLogout = async () => {
    await logout().catch(() => null);
    router.refresh();
  };

  // Scroll handler — drives the 80px → 64px blur shrink.
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 40);
    };
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Active-section underline — observes the real landing sections.
  useEffect(() => {
    const targets = navLinks
      .map((link) => document.querySelector(link.href))
      .filter((el): el is Element => el !== null);
    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(`#${entry.target.id}`);
          }
        });
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: 0.1 }
    );

    targets.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  // Close the mobile drawer on Escape + trava o scroll do body.
  // Foco vai ao fechar ao abrir e volta ao botão do menu ao fechar.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => closeButtonRef.current?.focus(), 60);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
      window.clearTimeout(t);
      menuButtonRef.current?.focus();
    };
  }, [mobileMenuOpen]);

  const scrollToSection = (href: string) => {
    scrollToSelector(href);
    setMobileMenuOpen(false);
  };

  return (
    <>
      <header
        className={cn(
          "fixed left-0 right-0 top-0 z-[30] transition-[height,background-color,border-color] duration-150 ease-out",
          "pt-[env(safe-area-inset-top)]",
          scrolled ? "glass-chrome h-[64px] border-b border-line1" : "h-[80px] bg-transparent"
        )}
      >
        <nav className="flex h-full w-full items-center justify-between px-4 sm:px-6 lg:px-8" aria-label="Navegação principal">
          {/* Logo */}
          <Link
            href="/"
            className="flex items-center gap-2 rounded-base text-text1 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="AurumBit - Início"
          >
            <Logo size="md" priority />
          </Link>

          {/* Desktop: links centralizados + ação única à direita */}
          <div className="hidden flex-1 items-center lg:flex">
            <nav className="flex flex-1 items-center justify-center gap-6" aria-label="Seções da página">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToSection(link.href);
                  }}
                  className={cn(
                    "relative whitespace-nowrap text-body font-medium transition-colors duration-150",
                    "after:absolute after:bottom-[-4px] after:left-0 after:h-[2px] after:w-0 after:bg-gradient-gold after:transition-[width] after:duration-150",
                    activeSection === link.href
                      ? "text-accent after:w-full"
                      : "text-text2 hover:text-accent hover:after:w-full"
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            <div className="ml-4 flex flex-shrink-0 items-center gap-2">
              <ThemeToggle />
              {user ? (
                <>
                  <Link href="/dashboard" className="btn-ghost text-body">
                    Dashboard
                  </Link>
                  <Button variant="primary" onClick={handleLogout}>
                    Sair
                  </Button>
                </>
              ) : (
                <Button
                  variant="primary"
                  leftIcon={<UserRound className="h-5 w-5" aria-hidden="true" />}
                  onClick={() => openAuthModal("login")}
                >
                  Acessar conta
                </Button>
              )}
            </div>
          </div>

          {/* Mobile Menu Button */}
          <div className="flex items-center gap-1 lg:hidden">
            <ThemeToggle />
            <button
              ref={menuButtonRef}
              className="rounded-base text-text2 transition-colors hover:bg-bg2 hover:text-text1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent min-h-[44px] min-w-[44px] flex items-center justify-center"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-menu"
              aria-label={mobileMenuOpen ? "Fechar menu" : "Abrir menu"}
            >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </nav>
      </header>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            id="mobile-menu"
            className="fixed inset-0 z-[46] lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="dialog"
            aria-modal="true"
            aria-label="Menu de navegação"
          >
            <motion.div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileMenuOpen(false)}
              aria-hidden="true"
            />
            <motion.div
              className="absolute right-0 top-0 flex h-full w-full max-w-sm flex-col border-l border-line2 bg-bg1 pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)]"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
            >
              <div className="flex items-center justify-between border-b border-line2 p-4">
                <Link
                  href="/"
                  className="flex items-center gap-2 text-text1"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="AurumBit - Início"
                >
                  <Logo size="sm" />
                </Link>
                <button
                  ref={closeButtonRef}
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded-base p-3 text-text2 transition-colors hover:bg-bg2 hover:text-text1 min-h-[44px] min-w-[44px]"
                  aria-label="Fechar menu"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <nav className="flex-1 overflow-y-auto p-4" aria-label="Navegação mobile">
                <ul className="space-y-3" role="list">
                  {navLinks.map((link) => (
                    <motion.li
                      key={link.href}
                      initial={{ opacity: 0, x: 24 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: 0, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <button
                        onClick={() => scrollToSection(link.href)}
                        className={cn(
                          "w-full rounded-base px-4 py-3 text-left text-body font-medium transition-colors",
                          activeSection === link.href
                            ? "bg-accent/10 text-accent"
                            : "text-text2 hover:bg-bg2 hover:text-text1"
                        )}
                      >
                        {link.label}
                      </button>
                    </motion.li>
                  ))}
                </ul>

                {/* Duplicated CTAs */}
                <motion.div
                  className="mt-8 space-y-3 border-t border-line2 pt-6"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0, ease: [0.16, 1, 0.3, 1] }}
                >
                  {user ? (
                    <>
                      <Link
                        href="/dashboard"
                        onClick={() => setMobileMenuOpen(false)}
                        className="btn-ghost w-full justify-start"
                      >
                        Dashboard
                      </Link>
                      <Button variant="primary" className="w-full" onClick={() => { handleLogout(); setMobileMenuOpen(false); }}>
                        Sair
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="primary"
                      className="w-full"
                      leftIcon={<UserRound className="h-5 w-5" aria-hidden="true" />}
                      onClick={() => { openAuthModal("login"); setMobileMenuOpen(false); }}
                    >
                      Acessar conta
                    </Button>
                  )}
                </motion.div>
              </nav>

              <div className="border-t border-line2 p-4 text-center text-caption text-text3">
                <p>© 2026 AurumBit. Todos os direitos reservados.</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
