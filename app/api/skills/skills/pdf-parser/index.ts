import type { Skill } from "../../skillTypes";
import { decodeBase64ToBuffer } from "../../skillShared";
import pdfParse from "pdf-parse";

export const skill: Skill = {
  id: "pdf-parser",
  name: "PDF Parser",
  description: "Parse a PDF and return text plus basic metadata (pages, etc.).",
  category: "documents",
  getStatus: () => "ready",
  run: async ({ input }) => {
    const obj = (input ?? {}) as { base64?: unknown };
    const base64 = typeof obj.base64 === "string" ? obj.base64 : "";
    if (!base64) return { ok: false, error: "base64 is required" };
    const buffer = decodeBase64ToBuffer(base64);
    try {
      const data = await pdfParse(buffer);
      return {
        ok: true,
        output: {
          pages: data.numpages ?? null,
          info: data.info ?? null,
          metadata: data.metadata ?? null,
          text: (data.text ?? "").toString(),
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to parse PDF";
      return { ok: false, error: msg };
    }
  },
};
