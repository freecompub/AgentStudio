/**
 * Schéma du `meta` d'un workflow (ADR 0055, `docs/11` §4). Fermé : un champ inconnu est refusé.
 * Les règles qui croisent plusieurs champs, ou le dossier, sont dans `verifierMeta`.
 */
import { access } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import { z } from "zod";

const NOM = /^[a-z][a-z0-9-]{0,39}$/;
const PROFILS = ["testeur", "po", "developpeur", "architecte", "administrateur"] as const;
/** Outils que la plateforme fournit aux agents ; un workflow peut en apporter d'autres, déclarés dans `outils` (ADR 0082). */
export const OUTILS_PLATEFORME = ["list_files", "run_tests", "run_lint", "report_blocker"] as const;
const SKILL = /^[a-z][a-z0-9-]*(#.+)?$/;
const texte = (max: number) => z.string().trim().min(1).max(max);

const agent = z
  .object({
    prompt: texte(200),
    /** Consignes propres à agent-studio, ajoutées au contenu du fichier d'agent (ADR 0024). */
    consignes: texte(20_000).optional(),
    classe: z.enum(["strong", "standard", "light"]).optional(),
    reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
    contextTier: z.enum(["default", "long_context"]).optional(),
    ecriture: z.array(texte(200)).optional(),
    outils: z.array(texte(40)).optional(),
    skills: z.object({ obligatoires: z.array(z.string().regex(SKILL)).optional(), aLaDemande: z.array(z.string().regex(SKILL)).optional() }).strict().optional(),
    sortie: z.enum(["report_phase", "submit_plan", "submit_difficulty", "submit_lens_verdict", "submit_lecons"]),
    memoire: z.enum(["tache", "tour"]).optional(),
  })
  .strict();

export const schemaMeta = z
  .object({
    name: z.string().regex(NOM, "nom : minuscules, chiffres et tirets"),
    description: texte(500),
    commande: z.string().regex(NOM, "commande : minuscules, chiffres et tirets"),
    entrees: z
      .record(
        z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
        z.object({ type: z.enum(["fichier", "texte", "booleen"]), obligatoire: z.boolean().optional(), defaut: z.union([z.string(), z.boolean()]).optional(), aide: texte(300) }).strict(),
      )
      .default({}),
    phases: z.record(z.string().regex(/^[A-ZÉ][A-Z0-9_É]*$/), texte(80)).default({}),
    humains: z.record(z.string().regex(NOM), z.array(z.enum(PROFILS))).default({}),
    permissions: z
      .object({ ecriture: z.array(texte(200)).default([]), tests: z.boolean().default(false), git: z.array(z.enum(["branche", "commit", "revert"])).default([]) })
      .strict()
      .default({ ecriture: [], tests: false, git: [] }),
    /** Outils apportés par le workflow à ses agents (ADR 0082) ; leur code est exporté par le script (`outils`). */
    outils: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "outil : minuscules, chiffres et soulignés"), z.object({ description: texte(500) }).strict()).default({}),
    agents: z.record(z.string().regex(NOM), agent).default({}),
  })
  .strict();

export type MetaWorkflow = z.infer<typeof schemaMeta>;

const existe = (p: string) => access(p).then(
  () => true,
  () => false,
);

/** Chemin relatif au dossier du workflow, qui n'en sort pas. */
function cheminInterne(rel: string): boolean {
  if (isAbsolute(rel)) return false;
  const n = normalize(rel);
  return !n.startsWith("..") && !n.split(/[\\/]/).includes("..");
}

/** Valide un `meta` lu dans le dossier `dossier` ; rend le meta typé, ou les motifs du refus. */
export async function verifierMeta(brut: unknown, dossier: string): Promise<{ ok: true; meta: MetaWorkflow } | { ok: false; motifs: string[] }> {
  const r = schemaMeta.safeParse(brut);
  if (!r.success) return { ok: false, motifs: r.error.issues.map((i) => `${i.path.join(".") || "meta"} : ${i.code === "unrecognized_keys" ? `champ inconnu ${(i as { keys: string[] }).keys.join(", ")}` : i.message}`) };
  const m = r.data;
  const motifs: string[] = [];
  for (const [nom, a] of Object.entries(m.agents)) {
    if (!cheminInterne(a.prompt)) motifs.push(`agents.${nom} : chemin hors du dossier du workflow : ${a.prompt}`);
    else if (!(await existe(join(dossier, a.prompt)))) motifs.push(`agents.${nom} : fichier ${a.prompt} introuvable dans le dossier du workflow`);
    for (const s of [...(a.skills?.obligatoires ?? []), ...(a.skills?.aLaDemande ?? [])]) {
      const base = s.split("#")[0]!;
      if (!(await existe(join(dossier, "skills", base, "SKILL.md")))) motifs.push(`agents.${nom} : skill ${base} introuvable (skills/${base}/SKILL.md)`);
    }
    for (const o of a.outils ?? []) {
      if (o in m.outils) continue;
      if (!(OUTILS_PLATEFORME as readonly string[]).includes(o)) motifs.push(`agents.${nom} : outil inconnu ${o} (outils de la plateforme : ${OUTILS_PLATEFORME.join(", ")} ; ou déclare-le dans meta.outils)`);
      else if ((o === "run_tests" || o === "run_lint") && !m.permissions.tests) motifs.push(`agents.${nom} : ${o} exige permissions.tests`);
    }
    // Un agent n'écrit jamais plus que le workflow ne déclare : chaque motif doit y figurer tel quel.
    for (const e of a.ecriture ?? [])
      if (!m.permissions.ecriture.includes(e)) motifs.push(`agents.${nom} : écriture ${e} absente de permissions.ecriture`);
  }
  return motifs.length ? { ok: false, motifs } : { ok: true, meta: m };
}
