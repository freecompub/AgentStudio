import { describe, expect, it } from "vitest";
import { fingerprintFiles } from "../src/fingerprint.js";

function store(files: Record<string, string>) {
  return { list: async () => Object.keys(files), read: async (p: string) => files[p]! };
}
const isTest = (p: string) => p.startsWith("tests/");

describe("fingerprintFiles (gel des tests, D21)", () => {
  it("stable quel que soit l'ordre de listage, ignore les fichiers hors périmètre", async () => {
    const a = await fingerprintFiles(store({ "tests/a.ts": "1", "tests/b.ts": "2", "src/x.ts": "x" }), isTest);
    const b = await fingerprintFiles(store({ "src/x.ts": "autre", "tests/b.ts": "2", "tests/a.ts": "1" }), isTest);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["contenu modifié", { "tests/a.ts": "1bis", "tests/b.ts": "2" }],
    ["fichier supprimé", { "tests/a.ts": "1" }],
    ["fichier ajouté", { "tests/a.ts": "1", "tests/b.ts": "2", "tests/c.ts": "" }],
    ["fichier renommé", { "tests/a2.ts": "1", "tests/b.ts": "2" }],
  ])("change si %s", async (_label, files) => {
    const base = await fingerprintFiles(store({ "tests/a.ts": "1", "tests/b.ts": "2" }), isTest);
    expect(await fingerprintFiles(store(files), isTest)).not.toBe(base);
  });

  it("frontières de fichiers non ambiguës", async () => {
    const a = await fingerprintFiles(store({ "tests/a": "bc" }), isTest);
    const b = await fingerprintFiles(store({ "tests/ab": "c" }), isTest);
    expect(a).not.toBe(b);
  });
});
