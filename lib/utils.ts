import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Simple check for risk status - can be expanded with more complex logic
export function isClientAtRisk(client: any): boolean {
  if (!client.blogProgress) return false;
  return !client.blogProgress.isOnTrack;
}
