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

function looksLikeRichHtml(input: string) {
  const s = (input ?? "").toString()
  if (!s.trim()) return false
  return /<\/?(p|h[1-6]|ul|ol|li|blockquote|pre|code|img|video|audio|br)\b/i.test(s)
}

function escapeHtml(text: string) {
  return (text ?? "")
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function renderInline(raw: string) {
  const base = escapeHtml(raw)
  const codes: string[] = []
  let text = base.replace(/`([^`]+)`/g, (_m, p1: string) => {
    const idx = codes.length
    codes.push(p1)
    return `\u0000CODE${idx}\u0000`
  })

  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
    const u = (url ?? "").toString().trim()
    if (!/^(https?:\/\/|mailto:)/i.test(u)) return _m
    const safe = escapeHtml(u)
    return `<a href="${safe}" target="_blank" rel="noreferrer noopener">${label}</a>`
  })

  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  text = text.replace(/~~([^~]+)~~/g, "<s>$1</s>")
  text = text.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>")

  text = text.replace(/\u0000CODE(\d+)\u0000/g, (_m, idx: string) => {
    const i = Number(idx)
    return `<code>${codes[i] ?? ""}</code>`
  })

  return text
}

function markdownishToHtml(input: string) {
  const md = (input ?? "").toString().replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const lines = md.split("\n")

  const out: string[] = []
  let para: string[] = []
  let list: { type: "ul" | "ol"; items: string[] } | null = null
  let bqParas: string[] = []
  let bqPara: string[] = []
  let inCode = false
  let codeLang = ""
  let codeLines: string[] = []

  const flushPara = () => {
    if (para.length === 0) return
    out.push(`<p>${para.map(renderInline).join("<br />")}</p>`)
    para = []
  }
  const flushList = () => {
    if (!list) return
    const tag = list.type
    const items = list.items.map((it) => `<li>${renderInline(it)}</li>`).join("")
    out.push(`<${tag}>${items}</${tag}>`)
    list = null
  }
  const flushBqPara = () => {
    if (bqPara.length === 0) return
    bqParas.push(`<p>${bqPara.map(renderInline).join("<br />")}</p>`)
    bqPara = []
  }
  const flushBlockquote = () => {
    flushBqPara()
    if (bqParas.length === 0) return
    out.push(`<blockquote>${bqParas.join("")}</blockquote>`)
    bqParas = []
  }
  const flushCode = () => {
    if (!inCode) return
    const lang = (codeLang ?? "").toString().replace(/[^a-z0-9_-]/gi, "")
    const klass = lang ? ` class="language-${lang}"` : ""
    out.push(`<pre><code${klass}>${escapeHtml(codeLines.join("\n"))}</code></pre>`)
    inCode = false
    codeLang = ""
    codeLines = []
  }

  for (const rawLine of lines) {
    const line = (rawLine ?? "").toString().replace(/\s+$/g, "")
    const trimmed = line.trim()

    if (inCode) {
      if (/^```/.test(trimmed)) {
        flushCode()
        continue
      }
      codeLines.push(line)
      continue
    }

    const fence = trimmed.match(/^```(\S*)\s*$/)
    if (fence) {
      flushPara()
      flushList()
      flushBlockquote()
      inCode = true
      codeLang = fence[1] ?? ""
      continue
    }

    const isBq = /^\s*>/.test(line)
    if (!isBq && trimmed) {
      flushBlockquote()
    }

    if (!trimmed) {
      flushPara()
      flushList()
      flushBqPara()
      continue
    }

    if (isBq) {
      flushPara()
      flushList()
      const text = line.replace(/^\s*>\s?/, "")
      bqPara.push(text)
      continue
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      flushPara()
      flushList()
      flushBlockquote()
      const level = Math.min(6, Math.max(1, heading[1]!.length))
      out.push(`<h${level}>${renderInline(heading[2] ?? "")}</h${level}>`)
      continue
    }

    const ul = trimmed.match(/^[-*+]\s+(.+)$/)
    if (ul) {
      flushPara()
      flushBlockquote()
      if (list && list.type !== "ul") flushList()
      if (!list) list = { type: "ul", items: [] }
      list.items.push(ul[1] ?? "")
      continue
    }

    const ol = trimmed.match(/^\d+\.\s+(.+)$/)
    if (ol) {
      flushPara()
      flushBlockquote()
      if (list && list.type !== "ol") flushList()
      if (!list) list = { type: "ol", items: [] }
      list.items.push(ol[1] ?? "")
      continue
    }

    if (list) flushList()
    para.push(line)
  }

  flushCode()
  flushPara()
  flushList()
  flushBlockquote()
  const html = out.join("")
  if (html.trim()) return html
  return `<p>${renderInline(md)}</p>`
}

export function ensureDocHtmlContent(input: unknown) {
  const raw = typeof input === "string" ? input : String(input ?? "")
  const normalized = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\n1\.\s*/g, "\n")
    .replace(/\\n/g, "\n")
  if (!normalized.trim()) return ""
  if (looksLikeRichHtml(normalized)) return normalized
  return markdownishToHtml(normalized)
}
