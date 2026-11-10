/**
 * Activation d'un workflow trouvé (ADR 0055, `docs/11` §6, §7, §8). L'utilisateur ne voit que le
 * `meta` ; en interne, la plateforme en tire une déclaration et s'appuie sur la machinerie qui
 * exécute déjà les effets des extensions — composition des prompts, gardes, preuves, et
 * **vérification de chaque appel contre les permissions** (`fs:write:<motif>`, `git:*`,
 * `shell:test`). Le script, lui, n'en reçoit rien : il tourne isolé et ne voit que `w.*`.
 */
import { API_VERSION, type ExtensionManifest, type ExtensionModule, type Permission } from "@agent-studio/extension-api";
import { activateInProcess, type ExtensionHandle, type HostDeps, type ProcessLauncher } from "@agent-studio/extension-host";
import { validateManifest } from "@agent-studio/extension-manifest";
import { verifierAccord, type AccordStore } from "../accord/accords.js";
import type { WorkflowTrouve } from "../chargeur/chargeur.js";
import type { MetaWorkflow } from "../chargeur/schema.js";
import type { Json } from "../protocols.js";
import { createWorkflowTaskDepuis } from "../workflow-task.js";
import { compilerWorkflow } from "./compiler.js";
import { createRejoueurIsole } from "./rejoueur.js";

const GIT: Record<string, Permission> = { branche: "git:branch", commit: "git:commit", revert: "git:revert" };

/** Déclaration interne tirée du meta : permissions, agents, skills, commande, tâche. */
export function manifesteDuWorkflow(w: WorkflowTrouve): ExtensionManifest {
  const m = w.meta;
  const agents = Object.entries(m.agents);
  const skills = [...new Set(agents.flatMap(([, a]) => [...(a.skills?.obligatoires ?? []), ...(a.skills?.aLaDemande ?? [])].map((s) => s.split("#")[0]!)))];
  return {
    id: `workflow.${m.name}`,
    version: "0.0.0",
    publisher: "workflow",
    engines: { appApi: "^0.1" },
    permissions: [
      "fs:read",
      ...m.permissions.ecriture.map((e) => `fs:write:${e}` as Permission),
      ...(m.permissions.tests ? (["shell:test"] as Permission[]) : []),
      ...m.permissions.git.map((g) => GIT[g]!),
      ...(agents.length ? (["copilot:sessions"] as Permission[]) : []),
    ],
    contributes: {
      commands: [{ name: m.commande, title: m.name, description: m.description }],
      agents: agents.map(([name, a]) => ({
        name,
        title: name,
        prompt: a.prompt,
        ...(a.consignes ? { role: a.consignes } : {}),
        output: a.sortie,
        ...(a.ecriture ? { write: [...a.ecriture] } : {}),
        ...(a.outils ? { tools: [...a.outils] } : {}),
        ...(a.skills ? { skills: { ...(a.skills.obligatoires ? { mandatory: [...a.skills.obligatoires] } : {}), ...(a.skills.aLaDemande ? { onDemand: [...a.skills.aLaDemande] } : {}) } } : {}),
        ...(a.classe ? { modelClass: a.classe } : {}),
        ...(a.reasoningEffort ? { reasoningEffort: a.reasoningEffort } : {}),
        ...(a.contextTier ? { contextTier: a.contextTier } : {}),
        ...(a.memoire ? { memoire: a.memoire } : {}),
      })),
      skills: skills.map((name) => ({ name, path: `skills/${name}` })),
      // Le titre de la carte est court (80 caractères) : le nom, pas la description.
      tasks: [{ name: m.name, title: m.name, states: { ...m.phases } }],
    },
  };
}

/** Forme de la commande : `/demo <story> [--auto]`. */
export function syntaxeCommande(commande: string, entrees: MetaWorkflow["entrees"]): string {
  const noms = Object.keys(entrees);
  const args = [
    ...noms.filter((n) => entrees[n]!.type !== "booleen").map((n) => (entrees[n]!.obligatoire ? `<${n}>` : `[${n}]`)),
    ...noms.filter((n) => entrees[n]!.type === "booleen").map((n) => `[--${n}]`),
  ];
  return [`/${commande}`, ...args].join(" ");
}

/** Arguments d'une commande d'après `meta.entrees` : positionnels dans l'ordre, booléens en `--nom`, autres aussi en `--nom valeur`. */
export function lireEntrees(entrees: MetaWorkflow["entrees"], args: string, commande = "workflow"): { ok: true; entree: Record<string, Json> } | { ok: false; usage: string } {
  const noms = Object.keys(entrees);
  const positionnels = noms.filter((n) => entrees[n]!.type !== "booleen");
  const usage = () => `Utilisation : \`${syntaxeCommande(commande, entrees)}\`\n` + noms.map((n) => `- ${n} : ${entrees[n]!.aide}`).join("\n");
  const entree: Record<string, Json> = {};
  for (const n of noms) if (entrees[n]!.defaut !== undefined) entree[n] = entrees[n]!.defaut as Json;
  const restants = [...positionnels];
  const jetons = args.trim().split(/\s+/).filter(Boolean);
  for (let k = 0; k < jetons.length; k++) {
    const jeton = jetons[k]!;
    if (jeton.startsWith("--")) {
      const n = jeton.slice(2);
      if (!entrees[n]) return { ok: false, usage: usage() };
      if (entrees[n]!.type === "booleen") {
        entree[n] = true;
        continue;
      }
      // Entrée nommée : `--archi java`. Elle n'est plus attendue comme positionnelle.
      const valeur = jetons[++k];
      if (valeur === undefined || valeur.startsWith("--")) return { ok: false, usage: usage() };
      entree[n] = valeur;
      // Plus attendue comme positionnelle ; répétée, ou déjà donnée par position : la dernière l'emporte.
      const i = restants.indexOf(n);
      if (i >= 0) restants.splice(i, 1);
      continue;
    }
    const n = restants.shift();
    if (!n) return { ok: false, usage: usage() };
    entree[n] = jeton;
  }
  for (const n of positionnels) if (entrees[n]!.obligatoire && entree[n] === undefined) return { ok: false, usage: usage() };
  return { ok: true, entree };
}

export interface OptionsActivation {
  /** Lanceur du processus enfant et bundle de `enfant-entree.ts`. */
  isolation: { launcher: ProcessLauncher; runtimeEntry: string };
  accords: AccordStore;
  confirmer: { confirm(r: { title: string; detail: string }): Promise<"allow-once" | "allow-always" | "deny"> };
  /** Délai d'un rejeu (boucle) ; défaut du rejoueur. */
  delaiMs?: number;
}

export async function activerWorkflow(w: WorkflowTrouve, deps: HostDeps, o: OptionsActivation): Promise<{ ok: true; handle: ExtensionHandle; manifest: ExtensionManifest } | { ok: false; motifs: string[] }> {
  const compilation = await compilerWorkflow(w.dossier);
  if (!compilation.ok) return { ok: false, motifs: compilation.motifs };
  const v = validateManifest(manifesteDuWorkflow(w), { appApi: API_VERSION });
  if (!v.ok) return { ok: false, motifs: v.errors };
  const manifest = v.manifest;
  const m = w.meta;

  const rejoueur = createRejoueurIsole({
    code: compilation.code,
    launcher: o.isolation.launcher,
    runtimeEntry: o.isolation.runtimeEntry,
    humains: m.humains,
    agents: Object.keys(m.agents),
    ...(o.delaiMs ? { delaiMs: o.delaiMs } : {}),
  });
  const tache = createWorkflowTaskDepuis({ nom: m.name, empreinte: w.empreinte, humains: m.humains, rejoueur, refusEnTermesDuMeta: true });

  const module: ExtensionModule = {
    activate(ctx) {
      ctx.tasks.register(tache);
      ctx.chat.registerCommand(m.commande, async (args) => {
        const lu = lireEntrees(m.entrees, args, m.commande);
        if (!lu.ok) return ctx.chat.post(lu.usage);
        if (!(await verifierAccord({ workflow: w, accords: o.accords, confirmer: o.confirmer }))) return ctx.chat.post(`Workflow « ${m.name} » non lancé : accord refusé.`);
        await ctx.tasks.start(m.name, lu.entree);
        ctx.chat.post(`Workflow « ${m.name} » lancé (${w.origine}).`);
      });
    },
    deactivate() {
      rejoueur.arreter();
    },
  };

  try {
    const handle = await activateInProcess({ manifest, module, directory: w.dossier }, deps);
    return { ok: true, handle, manifest };
  } catch (e) {
    rejoueur.arreter();
    return { ok: false, motifs: [e instanceof Error ? e.message : String(e)] };
  }
}
