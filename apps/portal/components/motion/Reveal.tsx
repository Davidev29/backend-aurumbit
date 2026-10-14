"use client";

import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface RevealProps {
  children: ReactNode;
  variant?: "fade" | "slide-up" | "slide-down" | "slide-left" | "slide-right" | "scale";
  delay?: number;
  duration?: number;
  /**
   * @deprecated DESIGN.md: 1 entrada por viewport, sem stagger em cadeia.
   * Mantido por compatibilidade — prefira `delay={0}` e uma única entrada.
   */
  stagger?: number;
  threshold?: number;
  rootMargin?: string;
  once?: boolean;
  className?: string;
  style?: CSSProperties;
  id?: string;
}

const variants = {
  fade: {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
  },
  "slide-up": {
    hidden: { opacity: 0, y: 30 },
    visible: { opacity: 1, y: 0 },
  },
  "slide-down": {
    hidden: { opacity: 0, y: -30 },
    visible: { opacity: 1, y: 0 },
  },
  "slide-left": {
    hidden: { opacity: 0, x: 30 },
    visible: { opacity: 1, x: 0 },
  },
  "slide-right": {
    hidden: { opacity: 0, x: -30 },
    visible: { opacity: 1, x: 0 },
  },
  scale: {
    hidden: { opacity: 0, scale: 0.95 },
    visible: { opacity: 1, scale: 1 },
  },
};

export function Reveal({
  children,
  variant = "slide-up",
  delay = 0,
  duration = 0.5,
  stagger = 0,
  threshold = 0.1,
  rootMargin = "0px",
  // Anima descendo E subindo: re-dispara ao entrar/sair do viewport.
  // (Antes era `once: true` — animava só na 1ª descida e "morria".)
  once = false,
  className,
  style,
  id,
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Entrada/saída suaves nos dois sentidos: visível ↔ oculto.
    // Com `once`, desobserva após a 1ª entrada (comportamento antigo opt-in).
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (once) observer.unobserve(element);
        } else if (!once) {
          setIsVisible(false);
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [threshold, rootMargin, once]);

  const childArray = Array.isArray(children) ? children : [children];

  // Movimento reduzido: só opacity, sem deslocamento — nos dois sentidos.
  const activeVariants =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? variants.fade
      : variants[variant];

  return (
    <div ref={ref} id={id} className={cn(className)} style={style as CSSProperties}>
      {stagger > 0 && childArray.length > 1 ? (
        <motion.div
          variants={{
            hidden: { opacity: 0 },
            visible: {
              opacity: 1,
              transition: {
                staggerChildren: stagger,
              },
            },
          }}
          initial="hidden"
          animate={isVisible ? "visible" : "hidden"}
        >
          {childArray.map((child, index) => (
            <motion.div
              key={index}
              variants={activeVariants}
              style={{
                transitionDuration: `${duration}s`,
                transitionDelay: `${delay}s`,
              }}
            >
              {child}
            </motion.div>
          ))}
        </motion.div>
      ) : (
        <motion.div
          variants={activeVariants}
          initial="hidden"
          animate={isVisible ? "visible" : "hidden"}
          transition={{
            duration,
            delay,
            ease: [0.16, 1, 0.3, 1],
          }}
          style={style}
        >
          {children}
        </motion.div>
      )}
    </div>
  );
}

export interface TextRevealProps {
  children: ReactNode;
  splitBy?: "words" | "chars" | "lines";
  delay?: number;
  duration?: number;
  stagger?: number;
  className?: string;
  id?: string;
  as?: "p" | "span" | "h1" | "h2" | "h3" | "div";
}

/**
 * @deprecated DESIGN.md: sem stagger de texto em cadeia (1 entrada por
 * viewport). Mantido por compatibilidade.
 */
export function TextReveal({
  children,
  splitBy = "words",
  delay = 0,
  duration = 0.5,
  stagger = 0.05,
  className,
  id,
  as: Component = "p",
}: TextRevealProps) {
  const text = typeof children === "string" ? children : Array.isArray(children) ? children.join(" ") : String(children ?? "");
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(element);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const splitText = () => {
    if (splitBy === "words") {
      return text.split(/(\s+)/).filter((s) => s.length > 0);
    }
    if (splitBy === "chars") {
      return text.split("");
    }
    return text.split("\n");
  };

  const parts = splitText();

  const MotionComponent = motion[Component] as typeof motion.div;

  return (
    <MotionComponent ref={ref as never} id={id} className={cn("inline-block", className)}>
      {parts.map((part, index) => (
        <motion.span
          key={index}
          initial={{ opacity: 0, y: splitBy === "chars" ? 0 : 20, scale: 0.95 }}
          animate={isVisible ? { opacity: 1, y: 0, scale: 1 } : {}}
          transition={{
            duration,
            delay: delay + index * stagger,
            ease: [0.16, 1, 0.3, 1],
          }}
          style={{ display: splitBy === "words" && /\s/.test(part) ? "inline" : "inline-block" }}
        >
          {part}
        </motion.span>
      ))}
    </MotionComponent>
  );
}

export interface CounterProps {
  end: number;
  start?: number;
  duration?: number;
  delay?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  onComplete?: () => void;
}

/**
 * @deprecated DESIGN.md: sem contadores animados na landing (sem números
 * inventados). Mantido por compatibilidade — não usar em copy visível.
 */
export function Counter({
  end,
  start = 0,
  duration = 2,
  delay = 0,
  decimals = 0,
  prefix = "",
  suffix = "",
  className,
  onComplete,
}: CounterProps) {
  const [count, setCount] = useState(start);
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(element);
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) return;

    let animationFrame: number;
    const startTime = performance.now() + delay * 1000;

    const animate = (currentTime: number) => {
      if (currentTime < startTime) {
        animationFrame = requestAnimationFrame(animate);
        return;
      }

      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / (duration * 1000), 1);

      // Easing: easeOutExpo
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const current = start + (end - start) * eased;

      setCount(current);

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      } else {
        setCount(end);
        onComplete?.();
      }
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [isVisible, start, end, duration, delay, onComplete]);

  const formatted = count.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span ref={ref} className={cn("font-display font-bold", className)}>
      {prefix}{formatted}{suffix}
    </span>
  );
}