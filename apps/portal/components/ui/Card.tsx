"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
  bordered?: boolean;
  glass?: boolean;
  onClick?: () => void;
}

export function Card({
  children,
  className,
  hover = false,
  padding = "md",
  bordered = true,
  glass = true,
  onClick,
}: CardProps) {
  const paddings = {
    none: "",
    sm: "p-4",
    md: "p-6",
    lg: "p-8",
  };

  const baseClasses = cn(
    "rounded-card transition-[transform,border-color,box-shadow] duration-150 ease-out",
    glass && "glass-card",
    bordered && "border border-line2",
    hover && "hover:-translate-y-0.5 hover:border-line3 cursor-pointer",
    onClick && "cursor-pointer",
    paddings[padding],
    className
  );

  return (
    <div className={baseClasses} onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); }} : undefined}>
      {children}
    </div>
  );
}

export interface CardHeaderProps {
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}

export function CardHeader({ children, className, action }: CardHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4 mb-4", className)}>
      <div>{children}</div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

export interface CardTitleProps {
  children: ReactNode;
  className?: string;
  subtitle?: ReactNode;
}

export function CardTitle({ children, className, subtitle }: CardTitleProps) {
  return (
    <div>
      <h3 className={cn("text-headline font-display font-semibold text-text1", className)}>
        {children}
      </h3>
      {subtitle && <p className="mt-1 text-body text-text2">{subtitle}</p>}
    </div>
  );
}

export interface CardContentProps {
  children: ReactNode;
  className?: string;
}

export function CardContent({ children, className }: CardContentProps) {
  return <div className={cn(className)}>{children}</div>;
}

export interface CardFooterProps {
  children: ReactNode;
  className?: string;
  divided?: boolean;
}

export function CardFooter({ children, className, divided = true }: CardFooterProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 mt-4 pt-4",
        divided && "border-t border-line2",
        className
      )}
    >
      {children}
    </div>
  );
}