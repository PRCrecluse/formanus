import type { Skill } from "../../skillTypes";
import { decodeBase64ToBuffer } from "../../skillShared";
import * as XLSX from "xlsx";

export const skill: Skill = {
  id: "xlsx",
  name: "XLSX",
  description: "Extract tables from a .xlsx as text (sheet → TSV).",
  category: "documents",
  getStatus: () => "ready",
  run: async ({ input }) => {
    const obj = (input ?? {}) as { base64?: unknown };
    const base64 = typeof obj.base64 === "string" ? obj.base64 : "";
    if (!base64) return { ok: false, error: "base64 is required" };
    const buffer = decodeBase64ToBuffer(base64);
    try {
      const wb = XLSX.read(buffer, { type: "buffer" });
      const out: { name: string; tsv: string }[] = [];
      for (const name of wb.SheetNames.slice(0, 10)) {
        const sheet = wb.Sheets[name];
        const tsv = XLSX.utils.sheet_to_csv(sheet, { FS: "\t" });
        out.push({ name, tsv: tsv.slice(0, 50_000) });
      }
      return { ok: true, output: { sheets: out } };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to parse XLSX";
      return { ok: false, error: msg };
    }
  },
};
