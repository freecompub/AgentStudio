/**
 * Un seul fichier de projet (ADR 0071) : `.agent-studio/projet.yaml`, section `pile` (comment lancer
 * les outils, schéma du profil de pile) et section `qualite` (ce qui est exigé, schéma de la barre).
 * Ici, on ne fait que séparer : chaque section est rendue en YAML à son propre validateur. PUR.
 */
import { parse as parseYaml, parseDocument, stringify } from "yaml";

export const FICHIER_PROJET = ".agent-studio/projet.yaml";
const SECTIONS = ["pile", "qualite", "composants"] as const;

/** Un composant d'un projet qui mélange les technologies (ADR 0074) ; `pile` en YAML, pour son propre validateur. */
export interface ComposantDeclare {
  nom: string;
  racine: string;
  pile: string;
}

export function lireFichierProjet(raw: string): { pile?: string; qualite?: string; composants?: ComposantDeclare[] } | { error: string } {
  let data: unknown;
  try {
    data = parseYaml(raw) ?? {};
  } catch (err) {
    return { error: `\`${FICHIER_PROJET}\` n'est pas du YAML valide : ${err instanceof Error ? err.message.split("\n")[0] : String(err)}` };
  }
  if (typeof data !== "object" || Array.isArray(data)) return { error: `\`${FICHIER_PROJET}\` doit contenir les sections ${SECTIONS.join(", ")}.` };
  const inconnues = Object.keys(data as object).filter((k) => !(SECTIONS as readonly string[]).includes(k));
  if (inconnues.length) return { error: `\`${FICHIER_PROJET}\` : section inconnue ${inconnues.map((k) => `« ${k} »`).join(", ")} ; sections permises : ${SECTIONS.join(", ")}.` };
  const d = data as Record<string, unknown>;
  if (d["pile"] != null && d["composants"] != null)
    return { error: `\`${FICHIER_PROJET}\` : \`pile\` et \`composants\` ensemble ; l'une ou l'autre (\`pile\` seule vaut un composant de racine \`.\`, ADR 0074).` };
  const composants = d["composants"] != null ? lireComposants(d["composants"]) : null;
  if (composants && "error" in composants) return composants;
  return {
    ...(d["pile"] != null ? { pile: stringify(d["pile"]) } : {}),
    ...(d["qualite"] != null ? { qualite: stringify(d["qualite"]) } : {}),
    ...(composants ? { composants } : {}),
  };
}

/** `./services/api/` → `services/api` ; `` ou `./` → `.`. */
const normaliser = (r: string) => r.replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "") || ".";
const chevauchent = (a: string, b: string) => a === "." || b === "." || a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

function lireComposants(brut: unknown): ComposantDeclare[] | { error: string } {
  const erreur = (m: string) => ({ error: `\`${FICHIER_PROJET}\`, composants : ${m}` });
  if (!Array.isArray(brut) || brut.length === 0) return erreur("au moins un composant (nom, racine, pile) est attendu.");
  const out: ComposantDeclare[] = [];
  for (const [i, c] of brut.entries()) {
    const e = c as Record<string, unknown> | null;
    if (!e || typeof e !== "object") return erreur(`composants.${i} n'est pas un composant (nom, racine, pile).`);
    const inconnues = Object.keys(e).filter((k) => !["nom", "racine", "pile"].includes(k));
    if (inconnues.length) return erreur(`composants.${i} : clé inconnue ${inconnues.map((k) => `« ${k} »`).join(", ")}.`);
    if (typeof e["nom"] !== "string" || !e["nom"].trim()) return erreur(`composants.${i} : \`nom\` manquant.`);
    const nom = e["nom"].trim();
    if (typeof e["racine"] !== "string") return erreur(`composants.${i} (« ${nom} ») : \`racine\` manquante.`);
    if (e["pile"] == null || typeof e["pile"] !== "object") return erreur(`composants.${i} (« ${nom} ») : \`pile\` manquante.`);
    const racine = normaliser(e["racine"]);
    if (racine.startsWith("/") || /^[A-Za-z]:/.test(racine)) return erreur(`« ${nom} » : la racine doit être relative à la racine du projet (reçu : « ${e["racine"]} »).`);
    if (racine.split("/").includes("..")) return erreur(`« ${nom} » : la racine ne doit pas contenir \`..\` (reçu : « ${e["racine"]} »).`);
    if (out.some((x) => x.nom === nom)) return erreur(`« ${nom} » est déclaré deux fois.`);
    const voisin = out.find((x) => chevauchent(x.racine, racine));
    if (voisin) return erreur(`« ${voisin.nom} » (${voisin.racine}) et « ${nom} » (${racine}) : leurs racines se chevauchent ; un fichier n'appartient qu'à un composant.`);
    out.push({ nom, racine, pile: stringify(e["pile"]) });
  }
  return out;
}

/**
 * Écrit le profil de pile dans la section `pile` de `projet.yaml` (`/stack init`), en gardant le
 * reste du fichier tel quel, commentaires compris. Un fichier existant illisible n'est pas écrasé.
 */
export function ecrirePileDansProjet(existant: string | null, pile: string): string | { error: string } {
  const doc = parseDocument(existant ?? "");
  if (doc.errors.length) return { error: `\`${FICHIER_PROJET}\` n'est pas du YAML valide, rien n'a été écrit : ${doc.errors[0]!.message.split("\n")[0]}` };
  if (doc.contents === null) doc.contents = doc.createNode({}) as never;
  doc.set("pile", doc.createNode(parseYaml(pile)));
  return doc.toString();
}

/**
 * Écrit la section `composants` de `projet.yaml` (`/stack init`, ADR 0074), en gardant le reste du
 * fichier, commentaires compris ; une section `pile` est retirée, les deux ne vont pas ensemble.
 */
export function ecrireComposantsDansProjet(existant: string | null, composants: string): string | { error: string } {
  const doc = parseDocument(existant ?? "");
  if (doc.errors.length) return { error: `\`${FICHIER_PROJET}\` n'est pas du YAML valide, rien n'a été écrit : ${doc.errors[0]!.message.split("\n")[0]}` };
  if (doc.contents === null) doc.contents = doc.createNode({}) as never;
  doc.delete("pile");
  doc.set("composants", doc.createNode(parseYaml(composants)));
  return doc.toString();
}
