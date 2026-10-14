"use client";

import { Fragment, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  showCloseButton?: boolean;
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  className?: string;
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  size = "md",
  showCloseButton = true,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  className,
}: ModalProps) {
  const uid = useId().replace(/:/g, "");
  const titleId = title ? `modal-title-${uid}` : undefined;
  const descId = description ? `modal-desc-${uid}` : undefined;
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<Element | null>(null);

  const sizes = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-3xl",
    full: "max-w-4xl",
  };

  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closeOnEscape, onClose]);

  useEffect(() => {
    if (isOpen) {
      restoreRef.current = document.activeElement;
      document.body.style.overflow = "hidden";
      // Foca o painel; o primeiro Tab vai ao primeiro controle.
      const t = window.setTimeout(() => panelRef.current?.focus(), 60);
      return () => {
        window.clearTimeout(t);
        document.body.style.overflow = "";
        (restoreRef.current as HTMLElement | null)?.focus?.();
      };
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Focus-trap leve: Tab/Shift+Tab ciclam dentro do painel.
  const handleTrap = (e: ReactKeyboardEvent) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => el.offsetParent !== null);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <Fragment>
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeOnOverlayClick ? onClose : undefined}
            aria-hidden="true"
          />
          <motion.div
            className={cn(
              "fixed inset-0 z-[50] flex items-center justify-center p-4",
              "pointer-events-none"
            )}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
          >
            <motion.div
              ref={panelRef}
              tabIndex={-1}
              onKeyDown={handleTrap}
              className={cn(
                "glass-modal w-full pointer-events-auto",
                sizes[size],
                className
              )}
              role="document"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              {(title || showCloseButton) && (
                <div className="flex items-start justify-between gap-4 p-6 border-b border-line2">
                  <div>
                    {title && (
                      <h2
                        id={titleId}
                        className="text-title-page font-display font-bold text-text1"
                      >
                        {title}
                      </h2>
                    )}
                    {description && (
                      <p
                        id={descId}
                        className="mt-1 text-body text-text2"
                      >
                        {description}
                      </p>
                    )}
                  </div>
                  {showCloseButton && (
                    <button
                      onClick={onClose}
                      className="flex-shrink-0 min-h-[44px] min-w-[44px] p-3 rounded-base text-text3 hover:text-text1 hover:bg-bg2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      aria-label="Fechar modal"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>
              )}
              <div className={cn(title || showCloseButton ? "p-6 pt-0" : "p-6")}>
                {children}
              </div>
            </motion.div>
          </motion.div>
        </Fragment>
      )}
    </AnimatePresence>
  );

  if (typeof window === "undefined") return null;

  return createPortal(modalContent, document.body);
}