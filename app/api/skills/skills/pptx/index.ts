import type { Skill } from "../../skillTypes";
import { decodeBase64ToBuffer } from "../../skillShared";
import JSZip from "jszip";

function stripHtml(html: string): string {
  const base = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return base;
}

async function extractPptxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files)
    .filter((n) => n.startsWith("ppt/slides/slide") && n.endsWith(".xml"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const parts: string[] = [];
  for (const name of slideNames) {
    const xml = await zip.file(name)!.async("string");
    const matches = xml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) ?? [];
    const text = matches.map((m) => m.replace(/<a:t[^>]*>/, "").replace(/<\/a:t>/, "")).join(" ");
    const cleaned = stripHtml(text)
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    if (cleaned) parts.push(cleaned);
  }
  return parts.join("\n");
}

export const skill: Skill = {
  id: "pptx",
  name: "PPTX",
  description: "Extract slide text from a .pptx (XML parsing).",
  category: "documents",
  getStatus: () => "ready",
  run: async ({ input }) => {
    const obj = (input ?? {}) as { base64?: unknown };
    const base64 = typeof obj.base64 === "string" ? obj.base64 : "";
    if (!base64) return { ok: false, error: "base64 is required" };
    const buffer = decodeBase64ToBuffer(base64);
    try {
      const text = await extractPptxText(buffer);
      return { ok: true, output: { text } };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to parse PPTX";
      return { ok: false, error: msg };
    }
  },
};
