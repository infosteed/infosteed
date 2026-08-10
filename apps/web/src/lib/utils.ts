// Derived from shadcn/ui (MIT); locally modified for InfoSteed.
// SPDX-License-Identifier: MIT AND AGPL-3.0-only
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
