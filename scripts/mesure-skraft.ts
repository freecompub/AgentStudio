/**
 * Mesure d'un vrai run de `skraft-pipeline` : durée et consommation **par tour**.
 *
 * Hors CI, consomme de vraies requêtes Copilot. Travaille sur une **copie** du projet d'essai :
 * le dépôt d'origine n'est jamais touché.
 *
 *   pnpm tsx scripts/mesure-skraft.ts <projet> <story> [minutes-max]
 *
 * Ce que le script ajoute par rapport à l'application : il écoute les événements `usage` **pendant**
 * le tour, pas seulement à sa fin. C'est précisément l'angle mort constaté le 28/09 — la carte de
 * tâche n'est rafraîchie qu'au terme d'un tour, donc elle est restée figée pendant les 1 h 55 du
 * tour qui dérapait.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createHookRegistry,
  createInteractionService,
  createJsonEvidenceStore,
  createJsonInteractionStore,
  createRegistry,
  createTaskAgentRunner,
  createUsageRecorder,
  createJsonlTraceStore,
  createJsonLogger,
  type AgentEvent,
  type AgentRuntime,
} from "@agent-studio/core";
import { createGhAuth, createNodeCommandRunner, createNodeProcessSpawner } from "@agent-studio/github-auth";
import { createCopilotClient, createCopilotRuntime } from "@agent-studio/runtime-copilot";
import { activateInProcess, type HostDeps } from "@agent-studio/extension-host";
import { createProfileAdapter, parseStackProfile } from "../packages/stack-adapters/src/index.js";
import { createJsonTaskStore, createTaskEngine } from "../packages/task-engine/src/index.js";
import { openWorkspace } from "@agent-studio/workspace";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createGhAuth } from "../packages/github-auth/src/index.js";
const execFileAsync = promisify(execFile);
import { DEFAULT_ALLOWED_PROGRAMS } from "../apps/desktop/src/main/admin-config.js";
import { manifest, skraftExtension, type SkraftState } from "../extensions/skraft/src/index.js";
// `scripts/` n'est pas couvert par `pnpm typecheck` (tsconfig.json n'inclut que packages, extensions
// et apps) : cet import profond ne serait pas signalé s'il était faux. Vérifié à l'exécution.
import { PHASE_ORDER } from "../extensions/skraft/src/config.js";

const args = process.argv.slice(2);
// `--depuis=DISTILL` : reprendre le pipeline à une phase donnée, les précédentes étant tenues pour
// faites. Sert à réessayer une phase tardive sans repayer celles d'avant — le dépôt source doit
// alors DÉJÀ contenir leurs livrables, le banc ne les fabrique pas.
const depuis = args.find((a) => a.startsWith("--depuis="))?.slice("--depuis=".length)?.toUpperCase();
const [source, storyPath, minutes] = args.filter((a) => !a.startsWith("--"));
if (!source || !storyPath) throw new Error("Utilisation : mesure-skraft.ts <projet> <story> [minutes-max] [--depuis=PHASE]");
const limite = Number(minutes ?? 90) * 60_000;
// `indexOf` rend -1 sur une phase inconnue, et `slice(-1)` rendrait la DERNIÈRE phase : une faute
// de frappe lancerait DELIVER seul. L'index est donc vérifié avant d'être utilisé.
const iDepuis = depuis ? PHASE_ORDER.indexOf(depuis as (typeof PHASE_ORDER)[number]) : 0;
if (depuis && iDepuis < 0) throw new Error(`--depuis : phase inconnue « ${depuis} » (attendu : ${PHASE_ORDER.join(", ")})`);
const phaseOrder = depuis ? PHASE_ORDER.slice(iDepuis) : undefined;

// ---------- Copie du projet : le dépôt d'origine n'est jamais touché ------------------------
// `realpath` : sous macOS, `mkdtemp` rend un chemin passant par le lien /var → /private/var, et le
// SDK Copilot recolle mal le chemin résolu (`…0000gnT/…` au lieu de `…0000gn/T/…`), ce qui fait
// refuser à l'agent la lecture de ses propres livrables. Le banc doit mesurer skraft, pas ça.
const root = await realpath(await mkdtemp(join(tmpdir(), "mesure-skraft-")));
execFileSync("git", ["clone", "-q", "--no-hardlinks", source, root]);
execFileSync("git", ["checkout", "-q", "main"], { cwd: root });
console.log(`Copie : ${root}\nBase  : ${execFileSync("git", ["log", "--oneline", "-1"], { cwd: root, encoding: "utf8" }).trim()}`);

// ---------- Journal des tours ---------------------------------------------------------------
interface Appel { at: number; inputTokens: number; outputTokens: number }
interface Tour { role: string; sessionId: string; debut: number; fin?: number; appels: Appel[] }
const tours: Tour[] = [];
const t0 = Date.now();
/** Combien d'événements `context` le runtime a réellement émis. Zéro = le plafond de l'ADR 0031 est aveugle. */
let contextes = 0;

/** Enveloppe du runtime : horodate l'ouverture de chaque session et chaque événement `usage`. */
function instrumente(rt: AgentRuntime): AgentRuntime {
  return {
    ...rt,
    async openSession(cfg) {
      const session = await rt.openSession(cfg);
      const tour: Tour = { role: cfg.role, sessionId: session.id, debut: Date.now(), appels: [] };
      tours.push(tour);
      console.log(`\n[${((Date.now() - t0) / 1000).toFixed(0).padStart(5)}s] ▶ ${cfg.role}  (prompt système ${cfg.systemPrompt.length} car.)`);
      session.onEvent((e: AgentEvent) => {
        // Occupation de la fenêtre (ADR 0031) : le plafond repose dessus, et personne n'a encore
        // vérifié que le runtime l'émet réellement. Sans cette ligne, on ne peut pas le savoir.
        if (e.type === "context") {
          contextes++;
          const pct = e.tokenLimit > 0 ? ((e.currentTokens / e.tokenLimit) * 100).toFixed(1) : "?";
          console.log(
            `        [${tour.sessionId.slice(0, 4)}] CONTEXTE : ${e.currentTokens}/${e.tokenLimit} = ${pct} %` +
              ` (système ${e.systemTokens ?? "?"}, conversation ${e.conversationTokens ?? "?"}, outils ${e.toolDefinitionsTokens ?? "?"}, ${e.messages ?? "?"} messages)`,
          );
          return;
        }
        if (e.type !== "usage") return;
        tour.appels.push({ at: Date.now(), inputTokens: e.inputTokens ?? 0, outputTokens: e.outputTokens ?? 0 });
        const cumul = tour.appels.reduce((n, a) => n + a.inputTokens, 0);
        const precedent = tour.appels.at(-2)?.at ?? tour.debut;
        const dt = ((Date.now() - precedent) / 1000).toFixed(1);
        console.log(`        [${tour.sessionId.slice(0, 4)}] appel #${tour.appels.length} : +${e.inputTokens ?? 0} entrée (cumul ${cumul}) en ${dt}s`);
      });
      const close = session.close.bind(session);
      return { ...session, close: async () => { tour.fin = Date.now(); await close(); } };
    },
  };
}

// ---------- Câblage réel ---------------------------------------------------------------------
const logger = createJsonLogger({ write: (l) => process.stderr.write(`${l}\n`), level: "info" });
const auth = createGhAuth({ runner: createNodeCommandRunner(), spawner: createNodeProcessSpawner() });
const runtime = instrumente(createCopilotRuntime({ client: createCopilotClient({ gitHubToken: await auth.token() }), logger }));
await runtime.start();

const tasksDir = await mkdtemp(join(tmpdir(), "mesure-taches-"));
const workspace = await openWorkspace(root);
const usage = createUsageRecorder(join(tasksDir, "usage"));
const engine = createTaskEngine({
  usage,
  store: createJsonTaskStore(tasksDir),
  checkpoints: workspace.checkpoints,
  clock: { now: () => new Date() },
  ids: { next: () => randomUUID() },
  logger,
});
const interactions = createInteractionService({
  store: createJsonInteractionStore(join(tasksDir, "interactions")),
  clock: { now: () => new Date() },
  ids: { next: () => randomUUID() },
  deliver: (taskId, option, comment) => engine.dispatch(taskId, { type: "HUMAN_DECISION", decision: option, ...(comment ? { comment } : {}) }),
});

// Réponses rejouées du run du 28/09, pour que la mesure soit comparable. À défaut : première option.
const REPONSES: [RegExp, string][] = [
  [/Difficult/i, "medium-hard"],
  [/paliers.*communs|communs.*paliers|par référence/i, "Les mêmes paliers s'appliquent à toutes les références"],
  [/mode d.arrondi|arrondi au plus proche/i, "Arrondi au plus proche, avec les demi-centimes arrondis vers le haut (comme l’exemple US-5)."],
  [/arrondir chaque remise|deux règles absentes/i, "Arrondir chaque remise de ligne à deux décimales et soustraire la remise de ATPayer"],
  [/plafond|dépasse le sous-total/i, "Taux non négatifs sans plafond ; plafonner la remise au sous-total de ligne."],
];
const repondues = new Set<string>();
const repondre = async () => {
  for (const q of await interactions.pending()) {
    if (repondues.has(q.id)) continue;
    repondues.add(q.id);
    const texte = `${q.title}\n${q.detail ?? ""}`;
    const voulue = REPONSES.find(([re]) => re.test(texte))?.[1];
    const choix = q.options.find((o) => o.id === voulue || o.label === voulue) ?? q.options[0]!;
    // Le profil doit être accepté par la demande : l'escalade n'admet ni le PO ni le testeur
    // (`requiredRoles`). Répondre « po » à tout laissait la demande sans réponse, donc la tâche en
    // attente définitive — deux runs gelés le 29/09 avant qu'on le voie.
    const role = q.requiredRoles?.length && !q.requiredRoles.includes("po") ? q.requiredRoles[0]! : "po";
    console.log(`\n[${((Date.now() - t0) / 1000).toFixed(0).padStart(5)}s] ❓ ${q.title}\n        → ${choix.label.slice(0, 110)}${role === "po" ? "" : ` (profil ${role})`}`);
    try {
      await interactions.respond(q.id, choix.id, undefined, { role });
    } catch (err) {
      // JAMAIS en silence : c'est le seul mécanisme qui débloque la tâche. Un refus avalé ne se
      // distingue pas d'un agent qui réfléchit, et le banc attend jusqu'au plafond.
      repondues.delete(q.id);
      console.error(`\n  ✖ réponse REFUSÉE pour « ${q.title} » : ${err instanceof Error ? err.message : String(err)}`);
      console.error("    La tâche reste en attente tant que personne n'y répond.");
    }
  }
};
interactions.onChange(() => void repondre());

const lu = parseStackProfile(await readFile(join(root, ".agent-studio/stack.yaml"), "utf8"), { allowedPrograms: DEFAULT_ALLOWED_PROGRAMS });
if ("error" in lu) throw new Error(`Profil refusé : ${lu.error}`);
// L'application libère les sessions quand la tâche se termine (ADR 0039, workspace-services.ts) ;
// le banc doit faire de même, sans quoi il laisse derrière lui un état que le produit supprime.
const agents = createTaskAgentRunner({ runtime, root: workspace.root, logger, trace: createJsonlTraceStore(join(tasksDir, "traces")) });
const hostDeps: HostDeps = {
  registry: createRegistry(),
  engine,
  agents,
  workspace,
  stack: createProfileAdapter(lu.profile),
  interactions,
  chat: { post: (_e, md) => console.log(`        [chat] ${md.split("\n")[0]?.slice(0, 120)}`) },
  evidence: createJsonEvidenceStore(join(tasksDir, "evidence")),
  hooks: createHookRegistry(),
  usage,
  clock: { now: () => new Date() },
  ids: { next: () => randomUUID() },
};
await activateInProcess({ manifest, module: skraftExtension, directory: join(process.cwd(), "extensions/skraft") }, hostDeps);

// ---------- Lancement ------------------------------------------------------------------------
// Réserve Copilot AVANT de lancer (ADR 0044) : une tâche skraft consomme des dizaines de requêtes
// premium, et le 29/09 un run a été lancé avec 28 en réserve. Jamais bloquant — seulement dit.
const quota = await createGhAuth({ runner: { run: async (cmd, args) => execFileAsync(cmd, [...args]).then((r) => ({ code: 0, ...r })).catch((e) => ({ code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? String(e) })) }, spawner: null as never }).copilotQuota();
if (!quota) console.log("Réserve Copilot : inconnue (gh absent, déconnecté, ou point d'accès changé).\n");
else {
  const alerte = quota.restantes <= 100 && !quota.depassementAutorise ? "  ⚠ insuffisant pour une tâche complète" : "";
  console.log(`Réserve Copilot : ${quota.restantes}/${quota.total} requêtes premium (${quota.pourcentageRestant} %), remise à zéro le ${quota.remiseAZero}${alerte}\n`);
}

const taskId = await engine.start("agent-studio.skraft/skraft-pipeline", { storyPath, confirmDifficulty: true, ...(phaseOrder ? { phaseOrder } : {}) });
if (phaseOrder)
  console.log(
    `Reprise à ${depuis} : phases ${phaseOrder.join(" → ")}.\n` +
      "  Les phases précédentes ne sont PAS dans `phasesCompleted` : le dossier de passation ne\n" +
      "  nommera pas leurs livrables, l'agent devra les trouver dans .skraft/<slug>/.",
  );
console.log(`Tâche ${taskId} sur ${storyPath}\n`);

const fini = async () => {
  const r = await engine.status(taskId);
  return r?.status === "finished";
};
const debut = Date.now();
while (!(await fini())) {
  if (Date.now() - debut > limite) {
    console.log("\n⏱  Limite du banc atteinte : annulation.");
    await engine.cancel(taskId);
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}

// ---------- Rapport --------------------------------------------------------------------------
const record = await engine.status(taskId);
const state = record?.state as SkraftState | undefined;
const s = (ms: number) => `${Math.floor(ms / 60000)}m${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}`;
const lignes = tours.map((t, i) => {
  const entree = t.appels.reduce((n, a) => n + a.inputTokens, 0);
  const sortie = t.appels.reduce((n, a) => n + a.outputTokens, 0);
  return { "#": i + 1, role: t.role.replace("agent-studio.skraft/", ""), duree: s((t.fin ?? Date.now()) - t.debut), appels: t.appels.length, entree, sortie };
});
console.log("\n\n===== TOURS =====");
console.table(lignes);
console.log(
  contextes
    ? `\n✔ Occupation du contexte : ${contextes} mesures reçues du runtime — le plafond de l'ADR 0031 voit quelque chose.`
    : "\n✖ AUCUNE mesure d'occupation reçue : le plafond de l'ADR 0031 est AVEUGLE sur ce runtime.",
);
console.log(`\nTotal : ${s(Date.now() - t0)}, ${lignes.reduce((n, l) => n + l.entree, 0)} tokens d'entrée, ${tours.length} tours.`);
console.log(`État final : ${state?.stage} / ${state?.phase}, essais ${state?.attempts}`);
console.log("Usage par phase :");
console.table(await usage.report(taskId));
await writeFile(join(tasksDir, "mesure.json"), JSON.stringify({ tours, lignes, state }, null, 2));
console.log(`\nDétail : ${join(tasksDir, "mesure.json")}\nTrace : ${join(tasksDir, "traces", `${taskId}.jsonl`)}\nCopie du projet : ${root}`);
await agents.releaseTask(taskId);
await runtime.stop();
process.exit(0);
