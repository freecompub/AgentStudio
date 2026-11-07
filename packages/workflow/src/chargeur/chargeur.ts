/**
 * Recherche des workflows (ADR 0055, `docs/11` §5) : chaque sous-dossier qui contient un
 * `workflow.mjs`, sur la machine puis dans le projet. Un dossier copié à la main est trouvé comme
 * un autre. À nom égal, le projet l'emporte. Un workflow invalide est écarté avec ses motifs, sans
 * empêcher les autres.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, readlink } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { extraireMeta } from "./meta.js";
import { verifierMeta, type MetaWorkflow } from "./schema.js";

export type Origine = "machine" | "projet";

export interface WorkflowTrouve {
  nom: string;
  origine: Origine;
  dossier: string;
  meta: MetaWorkflow;
  /** Empreinte de tout le dossier : l'accord de l'utilisateur et le gel s'y rattachent. */
  empreinte: string;
}

export interface Recherche {
  workflows: WorkflowTrouve[];
  erreurs: { dossier: string; motifs: string[] }[];
  /** Workflows du projet qui en remplacent un de la machine, pour le dire à l'utilisateur. */
  remplacements: { nom: string; dossierMachine: string; dossierProjet: string }[];
}

const SCRIPT = "workflow.mjs";

async function sousDossiers(racine: string): Promise<string[]> {
  try {
    return (await readdir(racine, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => join(racine, e.name))
      .sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

async function fichiers(dossier: string): Promise<{ p: string; lien: boolean }[]> {
  const out: { p: string; lien: boolean }[] = [];
  for (const e of await readdir(dossier, { withFileTypes: true })) {
    const p = join(dossier, e.name);
    if (e.isDirectory()) out.push(...(await fichiers(p)));
    else if (e.isFile()) out.push({ p, lien: false });
    // Un lien symbolique compte aussi, par sa cible : la compilation le suit (revue de la PR #12).
    else if (e.isSymbolicLink()) out.push({ p, lien: true });
  }
  return out;
}

/** Empreinte du dossier : chemins relatifs triés, contenus, et cible de chaque lien symbolique. Ne dépend ni de l'ordre ni de la machine. */
export async function empreinteDossier(dossier: string): Promise<string> {
  const h = createHash("sha256");
  const tous = (await fichiers(dossier)).map((f) => ({ ...f, rel: relative(dossier, f.p).split(sep).join("/") })).sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  for (const { p, rel, lien } of tous) {
    if (lien) {
      h.update(`${rel}\0lien\0${await readlink(p)}\0`);
      continue;
    }
    const contenu = await readFile(p);
    h.update(`${rel}\0${contenu.length}\0`);
    h.update(contenu);
  }
  return `sha256:${h.digest("hex")}`;
}

async function charger(dossier: string, origine: Origine): Promise<WorkflowTrouve | { dossier: string; motifs: string[] } | null> {
  let source: string;
  try {
    source = await readFile(join(dossier, SCRIPT), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  const lu = extraireMeta(source);
  if (!lu.ok) return { dossier, motifs: [lu.motif] };
  const v = await verifierMeta(lu.meta, dossier);
  if (!v.ok) return { dossier, motifs: v.motifs };
  return { nom: v.meta.name, origine, dossier, meta: v.meta, empreinte: await empreinteDossier(dossier) };
}

export async function trouverWorkflows(emplacements: { machine?: string; projet?: string }): Promise<Recherche> {
  const parNom = new Map<string, WorkflowTrouve>();
  const erreurs: Recherche["erreurs"] = [];
  const remplacements: Recherche["remplacements"] = [];
  for (const origine of ["machine", "projet"] as const) {
    const racine = emplacements[origine];
    if (!racine) continue;
    for (const dossier of await sousDossiers(racine)) {
      const r = await charger(dossier, origine);
      if (!r) continue;
      if (!("nom" in r)) {
        erreurs.push(r);
        continue;
      }
      const deja = parNom.get(r.nom);
      if (deja && deja.origine === "machine" && origine === "projet") remplacements.push({ nom: r.nom, dossierMachine: deja.dossier, dossierProjet: r.dossier });
      else if (deja) {
        erreurs.push({ dossier: r.dossier, motifs: [`nom ${r.nom} déjà pris par ${deja.dossier}`] });
        continue;
      }
      parNom.set(r.nom, r);
    }
  }
  const workflows = [...parNom.values()].sort((a, b) => (a.nom < b.nom ? -1 : 1));
  // Deux workflows ne peuvent pas répondre à la même commande.
  const parCommande = new Map<string, WorkflowTrouve>();
  const gardes: WorkflowTrouve[] = [];
  for (const w of workflows) {
    const autre = parCommande.get(w.meta.commande);
    if (autre) erreurs.push({ dossier: w.dossier, motifs: [`commande /${w.meta.commande} déjà prise par ${autre.dossier}`] });
    else {
      parCommande.set(w.meta.commande, w);
      gardes.push(w);
    }
  }
  return { workflows: gardes, erreurs, remplacements };
}
