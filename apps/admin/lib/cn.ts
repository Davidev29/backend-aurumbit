import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Une classes com precedência Tailwind (DS §10). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
