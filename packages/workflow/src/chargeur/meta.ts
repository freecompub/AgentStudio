/**
 * Lecture du `meta` d'un workflow SANS exécuter son script (ADR 0055, `docs/11` §4) : le fichier
 * est analysé, jamais évalué. Seule une valeur littérale est acceptée — objets, tableaux, chaînes,
 * nombres, booléens, `null` — d'où la règle « pas de variable, pas d'appel, pas de calcul ».
 */
import { parse, type Node } from "acorn";

export type Litteral = null | boolean | number | string | Litteral[] | { [k: string]: Litteral };

export type MetaLu = { ok: true; meta: Litteral } | { ok: false; motif: string };

type Noeud = Node & Record<string, unknown>;

class NonLitteral extends Error {}

export function extraireMeta(source: string): MetaLu {
  let programme: Noeud;
  try {
    programme = parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true }) as unknown as Noeud;
  } catch (e) {
    const loc = (e as { loc?: { line: number; column: number } }).loc;
    return { ok: false, motif: `script illisible (erreur de syntaxe${loc ? `, ligne ${loc.line}, colonne ${loc.column + 1}` : ""}) : ${(e as Error).message}` };
  }
  const init = trouverInit(programme);
  if (!init) return { ok: false, motif: "meta absent : le script doit commencer par `export const meta = { … }`" };
  try {
    return { ok: true, meta: valeur(init) };
  } catch (e) {
    if (e instanceof NonLitteral) return { ok: false, motif: `meta non littéral : ${e.message}` };
    throw e;
  }
}

function trouverInit(programme: Noeud): Noeud | undefined {
  for (const instr of programme["body"] as Noeud[]) {
    if (instr.type !== "ExportNamedDeclaration") continue;
    const decl = instr["declaration"] as Noeud | null;
    if (!decl || decl.type !== "VariableDeclaration" || decl["kind"] !== "const") continue;
    for (const d of decl["declarations"] as Noeud[]) {
      const id = d["id"] as Noeud;
      if (id.type === "Identifier" && id["name"] === "meta" && d["init"]) return d["init"] as Noeud;
    }
  }
  return undefined;
}

const ligne = (n: Noeud) => `ligne ${(n.loc as { start: { line: number } } | undefined)?.start.line ?? "?"}`;

function valeur(n: Noeud): Litteral {
  switch (n.type) {
    case "Literal": {
      const v = n["value"];
      if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
      throw new NonLitteral(`${ligne(n)} : expression régulière ou grand entier non admis`);
    }
    case "TemplateLiteral": {
      if ((n["expressions"] as Noeud[]).length) throw new NonLitteral(`${ligne(n)} : TemplateLiteral avec expression`);
      return ((n["quasis"] as Noeud[])[0]!["value"] as { cooked: string }).cooked;
    }
    case "UnaryExpression": {
      const arg = n["argument"] as Noeud;
      if (n["operator"] === "-" && arg.type === "Literal" && typeof arg["value"] === "number") return -(arg["value"] as number);
      throw new NonLitteral(`${ligne(n)} : UnaryExpression « ${String(n["operator"])} » non admise`);
    }
    case "ArrayExpression":
      return (n["elements"] as (Noeud | null)[]).map((e) => {
        if (!e) throw new NonLitteral(`${ligne(n)} : tableau à trous`);
        if (e.type === "SpreadElement") throw new NonLitteral(`${ligne(e)} : SpreadElement`);
        return valeur(e);
      });
    case "ObjectExpression": {
      const o: Record<string, Litteral> = {};
      for (const p of n["properties"] as Noeud[]) {
        if (p.type === "SpreadElement") throw new NonLitteral(`${ligne(p)} : SpreadElement`);
        if (p["computed"]) throw new NonLitteral(`${ligne(p)} : clé calculée`);
        if (p["method"] || p["kind"] !== "init") throw new NonLitteral(`${ligne(p)} : méthode ou accesseur`);
        if (p["shorthand"]) throw new NonLitteral(`${ligne(p)} : propriété abrégée (Identifier)`);
        const k = p["key"] as Noeud;
        const cle = k.type === "Identifier" ? (k["name"] as string) : String(k["value"]);
        o[cle] = valeur(p["value"] as Noeud);
      }
      return o;
    }
    default:
      throw new NonLitteral(`${ligne(n)} : ${n.type}`);
  }
}
