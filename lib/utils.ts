import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export type PersonaDocType = "persona" | "albums" | "posts"

export function normalizePersonaDocType(input: unknown): PersonaDocType {
  const raw = typeof input === "string" ? input : String(input ?? "")
  const base = raw.split(/[;:#|]/)[0]
  if (base === "persona" || base === "albums" || base === "posts") return base
  if (base === "photos" || base === "videos") return "albums"
  return "persona"
}

export function makePersonaDocDbId(personaId: string, docId: string) {
  return `${personaId}-${docId}`
}

export function getCleanPersonaDocId(personaId: string, dbId: string) {
  if (dbId.startsWith(`${personaId}-`)) {
    return dbId.slice(personaId.length + 1)
  }
  return dbId
}
