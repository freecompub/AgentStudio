/**
 * Disjoncteur des réessais (ADR 0073) : deux refus identiques de suite, on escalade. « Identique » :
 * même porte, même ensemble de motifs, à l'ordre et aux espaces près.
 */
import { describe, expect, it } from "vitest";
import { memeRefus, normaliserMotifs } from "../src/retries/meme-refus.js";

describe("memeRefus (ADR 0073)", () => {
  const a = { porte: "documents", motifs: ["Section « Découvertes » absente.", "Citation invalide : src/a.ts:3"] };

  it("même porte, mêmes motifs, dans un autre ordre ou avec des espaces : le même refus", () => {
    expect(memeRefus(a, { porte: "documents", motifs: ["  Citation invalide : src/a.ts:3", "Section « Découvertes » absente. "] })).toBe(true);
  });

  it("une autre porte, un motif de plus ou de moins, un motif différent : pas le même", () => {
    expect(memeRefus(a, { ...a, porte: "revue" })).toBe(false);
    expect(memeRefus(a, { ...a, motifs: [a.motifs[0]!] })).toBe(false);
    expect(memeRefus(a, { ...a, motifs: [a.motifs[0]!, "Citation invalide : src/a.ts:4"] })).toBe(false);
  });

  it("pas de refus précédent, ou aucun motif : jamais le même", () => {
    expect(memeRefus(null, a)).toBe(false);
    expect(memeRefus({ porte: "x", motifs: [] }, { porte: "x", motifs: [] })).toBe(false);
  });

  it("le préfixe du disjoncteur dit pourquoi l'escalade arrive avant le budget", async () => {
    const { MEME_REFUS } = await import("../src/retries/meme-refus.js");
    expect(MEME_REFUS).toBe("Même refus deux fois de suite : ");
  });

  it("préfixé une seule fois, quand l'escalade remonte du pas au scénario", async () => {
    const { disjoncte } = await import("../src/retries/meme-refus.js");
    expect(disjoncte(["a", "b"])).toEqual(["Même refus deux fois de suite : a", "b"]);
    expect(disjoncte(disjoncte(["a"]))).toEqual(["Même refus deux fois de suite : a"]);
  });
});

// LEC-1 : le registre des erreurs normalise les motifs comme le disjoncteur, avec la même fonction.
describe("normaliserMotifs", () => {
  it("espaces de bord retirés, doublons ôtés, ordre trié", () => {
    expect(normaliserMotifs(["  b ", "a", "b"])).toEqual(["a", "b"]);
  });
});
