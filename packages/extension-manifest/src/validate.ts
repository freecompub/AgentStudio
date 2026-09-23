import type { ExtensionManifest } from "@agent-studio/extension-api";
import { z } from "zod";
import { satisfies } from "./semver.js";

const NAME = /^[a-z][a-z0-9-]{0,39}$/;
const PERMISSION = /^(fs:read|fs:write:[^\s]+|shell:test|shell:[a-z0-9_.,-]+|git:(commit|branch|revert)|copilot:sessions|net:[a-z0-9.,*-]+)$/;
const text = (max: number) => z.string().trim().min(1).max(max);

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
          role: text(20_000),
          output: z.enum(["report_phase", "submit_plan"]),
          write: z.array(z.string().min(1)).optional(),
          tools: z.array(z.enum(["run_tests", "report_blocker"])).optional(),
        }),
      )
      .optional(),
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
  for (const a of m.contributes.agents ?? []) {
    for (const g of a.write ?? []) if (!writeGlobs.has(g)) errors.push(`agents.${a.name} : écrit dans ${g} sans la permission fs:write:${g}`);
    if (a.tools?.includes("run_tests") && !m.permissions.includes("shell:test")) errors.push(`agents.${a.name} : run_tests exige la permission shell:test`);
  }
  if ((m.contributes.agents ?? []).length && !m.permissions.includes("copilot:sessions"))
    errors.push("permissions : des agents sont déclarés sans la permission copilot:sessions");

  for (const [kind, list] of [
    ["commands", m.contributes.commands ?? []],
    ["agents", m.contributes.agents ?? []],
    ["tasks", m.contributes.tasks ?? []],
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
