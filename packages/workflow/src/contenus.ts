import { createHash } from "node:crypto";
import type { Json, Range } from "./protocols.js";

/** Au-delà, une valeur part dans le magasin de contenus et le journal n'en garde qu'un renvoi. */
export const SEUIL_CONTENU = 512;

/** JSON canonique : clés triées, `undefined` retiré. Deux valeurs égales ont le même texte. */
export function canon(v: unknown): string {
  return JSON.stringify(trier(v)) ?? "null";
}

function trier(v: unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : trier(x)));
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort()
        .map((k) => [k, trier(o[k])]),
    );
  }
  return v;
}

export const empreinteDe = (texte: string): string => `sha256:${createHash("sha256").update(texte).digest("hex")}`;

/** Range une valeur : en clair si elle est petite, sinon dans `contenus` sous son empreinte. */
export function ranger(v: unknown, contenus: Record<string, string>): Range {
  const texte = canon(v);
  if (texte.length <= SEUIL_CONTENU) return { clair: JSON.parse(texte) as Json };
  const ref = empreinteDe(texte);
  contenus[ref] ??= texte;
  return { ref };
}

export function relire(r: Range, contenus: Record<string, string>): Json {
  if ("clair" in r) return structuredClone(r.clair);
  const texte = contenus[r.ref];
  if (texte === undefined) throw new Error(`Contenu absent du magasin : ${r.ref}`);
  return JSON.parse(texte) as Json;
}
