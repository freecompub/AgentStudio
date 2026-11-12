import type { ExtensionManifest } from "@agent-studio/extension-api";
import { z } from "zod";
import { satisfies } from "./semver.js";

const NAME = /^[a-z][a-z0-9-]{0,39}$/;
/** Outils fournis par le cœur : leur handler est notre code, jamais celui de l'extension. */
const STANDARD_TOOLS = new Set(["run_tests", "run_lint", "list_files", "report_blocker"]);

const PERMISSION = /^(fs:read|fs:write:[^\s]+|shell:test|shell:[a-z0-9_.,-]+|git:(commit|branch|revert)|copilot:sessions|net:[a-z0-9.,*-]+)$/;
const text = (max: number) => z.string().trim().min(1).max(max);
/** Chemin d'un fichier ou dossier de l'extension : relatif, sans « .. » ni segment vide. */
const innerPath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith("/") && !/^[A-Za-z]:/.test(p) && p.split(/[\\/]/).every((s) => s !== ".." && s !== "." && s !== ""), "chemin relatif au dossier de l'extension, sans « .. »");
/** Référence à une skill : `nom`, ou `nom#Titre de section`. */
const SKILL_REF = /^([a-z][a-z0-9-]{0,39})(#.+)?$/;

const schema = z.object({
  id: z.string().regex(/^[a-z0-9-]+\.[a-z0-9-]+$/, "attendu « éditeur.nom » en minuscules"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "attendu x.y.z"),
  publisher: z.string().regex(/^[a-z0-9-]+$/),
  engines: z.object({ appApi: z.string().min(1) }),
  main: z
    .string()
    .refine((p) => !p.startsWith("/") && !p.split(/[\\/]/).includes("..") && /\.[cm]?js$/.test(p), "chemin relatif vers un .js, sans « .. »")
    .optional(),
  permissions: z.array(z.string()),
  contributes: z.object({
    commands: z.array(z.object({ name: z.string().regex(NAME), title: text(80), description: text(500) })).optional(),
    agents: z
      .array(
        z.object({
          name: z.string().regex(NAME),
          title: text(80),
          prompt: innerPath.refine((p) => p.endsWith(".md"), "fichier .md attendu").optional(),
          role: text(20_000).optional(),
          skills: z.object({ mandatory: z.array(z.string().regex(SKILL_REF)).optional(), onDemand: z.array(z.string().regex(SKILL_REF)).optional() }).optional(),
          output: z.enum(["report_phase", "submit_plan", "submit_difficulty", "submit_lens_verdict", "submit_lecons"]),
          write: z.array(z.string().min(1)).optional(),
          tools: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/)).optional(),
          // Classe de modèle (ADR 0048) : jamais un identifiant — le projet choisit le modèle réel.
          modelClass: z.enum(["strong", "standard", "light"]).optional(),
          reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
          contextTier: z.enum(["default", "long_context"]).optional(),
          // Mémoire de l'agent (ADR 0053) : gardée d'un tour à l'autre dans la tâche, ou neuve à chaque appel.
          memoire: z.enum(["tache", "tour"]).optional(),
        }),
      )
      .optional(),
    skills: z.array(z.object({ name: z.string().regex(NAME), path: innerPath })).optional(),
    tools: z.array(z.object({ name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), description: text(500) })).optional(),
    tasks: z
      .array(
        z.object({
          name: z.string().regex(NAME),
          title: text(80),
          states: z.record(z.string(), text(80)).refine((s) => Object.keys(s).length > 0, "au moins un état"),
          milestones: z.array(z.string()).optional(),
          alerts: z.array(z.string()).optional(),
        }),
      )
      .optional(),
  }),
});

export type ManifestValidation = { ok: true; manifest: ExtensionManifest } | { ok: false; errors: string[] };

/**
 * Valide un manifeste à l'installation et au démarrage (§5.1) : forme, compatibilité de l'API,
 * grammaire des permissions et cohérence entre contributions et permissions déclarées (D11).
 */
export function validateManifest(raw: unknown, app: { appApi: string }): ManifestValidation {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "manifeste"} : ${i.message}`) };
  const m = parsed.data;
  const errors: string[] = [];

  if (!satisfies(app.appApi, m.engines.appApi))
    errors.push(`engines.appApi : ${m.engines.appApi} incompatible avec l'API ${app.appApi} de l'application`);
  for (const p of m.permissions) if (!PERMISSION.test(p)) errors.push(`permissions : permission inconnue : ${p}`);

  const writeGlobs = new Set(m.permissions.filter((p) => p.startsWith("fs:write:")).map((p) => p.slice(9)));
  const skills = new Set((m.contributes.skills ?? []).map((s) => s.name));
  for (const a of m.contributes.agents ?? []) {
    if (!a.prompt && !a.role) errors.push(`agents.${a.name} : ni fichier de rôle (prompt) ni consignes (role)`);
    for (const ref of [...(a.skills?.mandatory ?? []), ...(a.skills?.onDemand ?? [])]) {
      const name = SKILL_REF.exec(ref)![1]!;
      if (!skills.has(name)) errors.push(`agents.${a.name} : skill non déclarée dans contributes.skills : ${name}`);
    }
    for (const g of a.write ?? []) if (!writeGlobs.has(g)) errors.push(`agents.${a.name} : écrit dans ${g} sans la permission fs:write:${g}`);
    // `run_lint` lance le linter du projet : un programme du projet, comme le lanceur de tests.
    for (const t of ["run_tests", "run_lint"] as const)
      if (a.tools?.includes(t) && !m.permissions.includes("shell:test")) errors.push(`agents.${a.name} : ${t} exige la permission shell:test`);
    const own = new Set((m.contributes.tools ?? []).map((t) => t.name));
    for (const t of a.tools ?? [])
      if (!STANDARD_TOOLS.has(t) && !own.has(t)) errors.push(`agents.${a.name} : outil inconnu ${t} (ni standard, ni déclaré dans contributes.tools)`);
  }
  if ((m.contributes.agents ?? []).length && !m.permissions.includes("copilot:sessions"))
    errors.push("permissions : des agents sont déclarés sans la permission copilot:sessions");

  for (const [kind, list] of [
    ["commands", m.contributes.commands ?? []],
    ["agents", m.contributes.agents ?? []],
    ["tasks", m.contributes.tasks ?? []],
    ["tools", m.contributes.tools ?? []],
    ["skills", m.contributes.skills ?? []],
  ] as const) {
    const seen = new Set<string>();
    for (const c of list) {
      if (seen.has(c.name)) errors.push(`${kind} : nom en double : ${c.name}`);
      seen.add(c.name);
    }
  }
  for (const t of m.contributes.tasks ?? []) {
    for (const s of [...(t.milestones ?? []), ...(t.alerts ?? [])])
      if (!(s in t.states)) errors.push(`tasks.${t.name} : jalon ou alerte sur un état non déclaré : ${s}`);
  }

  return errors.length ? { ok: false, errors } : { ok: true, manifest: JSON.parse(JSON.stringify(m)) as ExtensionManifest };
}
