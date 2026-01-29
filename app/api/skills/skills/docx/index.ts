import type { Skill } from "../../skillTypes";
import { decodeBase64ToBuffer } from "../../skillShared";
import mammoth from "mammoth";

export const skill: Skill = {
  id: "docx",
  name: "DOCX",
  description: "Extract plain text from a .docx (via mammoth).",
  category: "documents",
  getStatus: () => "ready",
  run: async ({ input }) => {
    const obj = (input ?? {}) as { base64?: unknown };
    const base64 = typeof obj.base64 === "string" ? obj.base64 : "";
    if (!base64) return { ok: false, error: "base64 is required" };
    const buffer = decodeBase64ToBuffer(base64);
    try {
      const res = await mammoth.extractRawText({ buffer });
      return { ok: true, output: { text: (res.value ?? "").toString() } };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to parse DOCX";
      return { ok: false, error: msg };
    }
  },
};
