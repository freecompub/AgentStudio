// @ts-nocheck — le workflow est en JavaScript, sans types (ADR 0055) : ce test vérifie son comportement, pas ses types.
/** sha256 sans dépendance du workflow : le serveur MCP l'importe hors du processus isolé (slug, 13/11). */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../../workflows/skraft/sha256.mjs";

describe("sha256Hex", () => {
  it("donne la même empreinte que node:crypto, texte vide, accents et textes longs compris", () => {
    for (const t of ["", "abc", "Plafonner le bolus proposé", "Remise par palier de quantité — 5 % dès 10 articles", "x".repeat(1000), "😀 emoji"])
      expect(sha256Hex(t), t.slice(0, 20)).toBe(createHash("sha256").update(t).digest("hex"));
  });
});
