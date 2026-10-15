import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Tailwind 클래스 결합(shadcn 방식). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
