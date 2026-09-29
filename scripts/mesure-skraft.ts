/**
 * Mesure d'un vrai run de `skraft-pipeline` : durée et consommation **par tour**.
 *
 * Hors CI, consomme de vraies requêtes Copilot. Travaille sur une **copie** du projet d'essai :
 * le dépôt d'origine n'est jamais touché.
 *
 *   pnpm tsx scripts/mesure-skraft.ts <projet> <story> [minutes-max] [--depuis=PHASE] [--base=BRANCHE] [--pousser]
 *                                     [--modeles=strong:claude-sonnet-5.5,light:gpt-5-mini]
 *
 * `--modeles` associe des classes de rôle à des modèles (ADR 0048) ; une classe absente laisse le
 * runtime décider.
 *
 * `--pousser` : pousse le travail de la copie sur une branche `run/<story>-<date>-<id>` du dépôt
 * GitHub du projet, après chaque phase commitée puis à la fin. C'est le banc qui pousse, jamais
 * l'agent (le contrat lui interdit Git), et jamais sur `main`.
 *
 * Suivi : chaque changement d'étape, rejet et fin de tour anormale est annoncé en direct par une
 * ligne commençant par `§`, lue dans la trace (ADR 0032) — la même source que le bilan final.
 * La réserve Copilot est relevée à chaque étape : l'écart donne la consommation RÉELLE par étape.
 *
 * Ce que le script ajoute par rapport à l'application : il écoute les événements `usage` **pendant**
 * le tour, pas seulement à sa fin. C'est précisément l'angle mort constaté le 28/09 — la carte de
 * tâche n'est rafraîchie qu'au terme d'un tour, donc elle est restée figée pendant les 1 h 55 du
 * tour qui dérapait.
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
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
  resumerTrace,
  resolveModel,
  MODEL_CLASSES,
  type ModelClass,
  type AgentEvent,
  type AgentRuntime,
  type ResumeEtape,
  type TraceEntry,
  type TraceStore,
} from "@agent-studio/core";
import { createGhAuth, createNodeCommandRunner, createNodeProcessSpawner } from "@agent-studio/github-auth";
import { createCopilotClient, createCopilotRuntime } from "@agent-studio/runtime-copilot";
import { activateInProcess, type HostDeps } from "@agent-studio/extension-host";
import { createProfileAdapter, parseStackProfile } from "../packages/stack-adapters/src/index.js";
import { createJsonTaskStore, createTaskEngine } from "../packages/task-engine/src/index.js";
import { openWorkspace } from "@agent-studio/workspace";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
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
const pousser = args.includes("--pousser");
// `--base=<branche>` : partir d'une branche du dépôt source plutôt que de `main` — typiquement la
// branche `run/…` poussée par un run précédent, pour reprendre avec `--depuis` sans repayer les
// phases déjà validées.
const base = args.find((a) => a.startsWith("--base="))?.slice("--base=".length) ?? "main";
// `--modeles=strong:x,light:y` : modèle réel par classe de rôle (ADR 0048).
const classesModeles = Object.fromEntries(
  (args.find((a) => a.startsWith("--modeles="))?.slice("--modeles=".length) ?? "")
    .split(",")
    .filter(Boolean)
    .map((p) => p.split(":") as [string, string]),
) as Partial<Record<ModelClass, string>>;
for (const k of Object.keys(classesModeles))
  if (!(MODEL_CLASSES as readonly string[]).includes(k)) throw new Error(`--modeles : classe inconnue « ${k} » (attendu : ${MODEL_CLASSES.join(", ")})`);
const depuis = args.find((a) => a.startsWith("--depuis="))?.slice("--depuis=".length)?.toUpperCase();
// `--en-place` : travailler DANS le dépôt donné, au lieu d'une copie jetable. Les livrables restent
// donc sous les yeux de l'utilisateur, avec son historique et ses branches — c'est tout l'intérêt,
// et c'est aussi le risque : le pipeline commite, crée une branche et peut rembobiner.
const enPlace = args.includes("--en-place");
const [source, storyPath, minutes] = args.filter((a) => !a.startsWith("--"));
if (!source || !storyPath)
  throw new Error("Utilisation : mesure-skraft.ts <projet> <story> [minutes-max] [--depuis=PHASE] [--base=BRANCHE] [--en-place] [--pousser] [--modeles=…]");
// `--base` choisit la branche à COPIER ; `--en-place` travaille sur l'état courant du dépôt, sans copie.
if (enPlace && args.some((a) => a.startsWith("--base="))) throw new Error("--base et --en-place sont incompatibles : en place, le banc part de l'état courant du dépôt.");
const limite = Number(minutes ?? 90) * 60_000;
// `indexOf` rend -1 sur une phase inconnue, et `slice(-1)` rendrait la DERNIÈRE phase : une faute
// de frappe lancerait DELIVER seul. L'index est donc vérifié avant d'être utilisé.
const iDepuis = depuis ? PHASE_ORDER.indexOf(depuis as (typeof PHASE_ORDER)[number]) : 0;
if (depuis && iDepuis < 0) throw new Error(`--depuis : phase inconnue « ${depuis} » (attendu : ${PHASE_ORDER.join(", ")})`);
const phaseOrder = depuis ? PHASE_ORDER.slice(iDepuis) : undefined;

// ---------- Où le run travaille -------------------------------------------------------------
// Par défaut une copie jetable : le dépôt d'origine n'est jamais touché. `--en-place` renverse ce
// choix, et l'annonce.
// `realpath` : sous macOS, `mkdtemp` rend un chemin passant par le lien /var → /private/var, et le
// SDK Copilot recolle mal le chemin résolu (`…0000gnT/…` au lieu de `…0000gn/T/…`), ce qui fait
// refuser à l'agent la lecture de ses propres livrables. Le banc doit mesurer skraft, pas ça.
let root: string;
if (enPlace) {
  root = await realpath(source);
  // Refuser un arbre sale : le pipeline commite et peut rembobiner. Emporter un travail en cours
  // que l'utilisateur n'a pas mis à l'abri serait la pire façon de lui rendre service.
  const sale = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim();
  if (sale)
    throw new Error(
      `--en-place refusé : l'arbre de travail de ${root} n'est pas propre.\n` +
        `Le pipeline commite, crée une branche et peut rembobiner : commitez ou mettez de côté d'abord.\n${sale}`,
    );
  console.log(`EN PLACE dans ${root} — ce dépôt SERA modifié (branche, commits, rembobinages).`);
  console.log(`Base  : ${execFileSync("git", ["log", "--oneline", "-1"], { cwd: root, encoding: "utf8" }).trim()}\n`);
} else {
  root = await realpath(await mkdtemp(join(tmpdir(), "mesure-skraft-")));
  execFileSync("git", ["clone", "-q", "--no-hardlinks", source, root]);
  execFileSync("git", ["checkout", "-q", base], { cwd: root });
  console.log(`Copie : ${root}\nBase  : ${execFileSync("git", ["log", "--oneline", "-1"], { cwd: root, encoding: "utf8" }).trim()}`);
}

// ---------- Branche de run sur GitHub (--pousser) ---------------------------------------------
// La copie est clonée depuis le dépôt local : son `origin` est un chemin. On pousse vers l'`origin`
// du dépôt source, c'est-à-dire GitHub. Une branche par run, jamais `main` : chaque run reste
// lisible et comparable aux autres.
const jour = new Date().toISOString().slice(0, 10);
const brancheRun = `run/${basename(storyPath, ".md").toLowerCase()}-${jour}-${randomUUID().slice(0, 4)}`;
const distant = pousser ? execFileSync("git", ["remote", "get-url", "origin"], { cwd: source, encoding: "utf8" }).trim() : null;
// En place, la « copie » EST le dépôt de l'utilisateur : son `origin` pointe déjà vers GitHub, et
// lui ajouter un remote modifierait durablement sa configuration. Dans une copie, `origin` est un
// chemin local : on y déclare le vrai distant sous un autre nom.
const nomDistant = enPlace ? "origin" : "github";
if (distant) {
  if (!enPlace) execFileSync("git", ["remote", "add", nomDistant, distant], { cwd: root });
  console.log(`Poussée : ${distant} → ${brancheRun}`);
}
let derniereSha = "";
/** Pousse HEAD de la copie. Jamais bloquant : un échec est dit, et le run continue. */
async function pousserBranche(motif: string): Promise<void> {
  if (!distant) return;
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  if (sha === derniereSha) return;
  try {
    // `--force-with-lease` : la branche appartient à ce seul run, et un rollback peut légitimement
    // réécrire ce qu'on y a poussé. Elle ne peut pas écraser le travail de quelqu'un d'autre.
    await execFileAsync("git", ["push", "-q", "--force-with-lease", nomDistant, `HEAD:refs/heads/${brancheRun}`], { cwd: root });
    derniereSha = sha;
    console.log(`§ ⇪ poussé sur ${brancheRun} (${sha.slice(0, 7)}, ${motif})`);
  } catch (err) {
    console.log(`§ ✖ poussée impossible (${motif}) : ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
  }
}

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
// Un jeton que Copilot refuse rend `400 Bad Request` à chaque tour : sans ce contrôle, le banc
// relançait l'escalade en boucle (03/10, un PAT classique `ghp_` sur une machine Linux).
const etatAuth = await auth.status();
if (!etatAuth.loggedIn || !etatAuth.copilotCompatible) {
  console.error(
    `Jeton GitHub refusé par Copilot (${etatAuth.loggedIn ? `type ${etatAuth.tokenKind}` : "non connecté"}).\n` +
      "Se connecter en OAuth : gh auth login --hostname github.com --git-protocol https --web",
  );
  process.exit(2);
}
const runtime = instrumente(createCopilotRuntime({ client: createCopilotClient({ gitHubToken: await auth.token() }), logger }));
await runtime.start();

const tasksDir = await mkdtemp(join(tmpdir(), "mesure-taches-"));

// ---------- Suivi en direct, lu dans la trace -----------------------------------------------
const ghRunner = { run: async (cmd: string, a: readonly string[]) => execFileAsync(cmd, [...a]).then((r) => ({ code: 0, ...r })).catch((e) => ({ code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? String(e) })) };
const lireReserve = () => createGhAuth({ runner: ghRunner, spawner: null as never }).copilotQuota().catch(() => null);
/** Réserve relevée à chaque changement d'étape : l'écart entre deux relevés est la consommation réelle. */
const releves: { at: string; etape: string; restantes: number | null }[] = [];
const traceBrute = createJsonlTraceStore(join(tasksDir, "traces"));
const vues: TraceEntry[] = [];
// Arrondir les secondes AVANT de séparer les minutes : sinon 119,6 s s'affichait « 1m60 ».
const hms = (ms: number) => {
  const sec = Math.round(ms / 1000);
  return `${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, "0")}`;
};
/**
 * Requêtes premium d'après le SDK : chaque appel au modèle porte son coût en `nanoAiu`, et 10⁹
 * nanoAiu font une requête. Vérifié le 03/10 : 35,99 × 10⁹ sur CLASSIFY + RESEARCH, pour un écart
 * de réserve de 36. C'est la mesure par étape ; la réserve, elle, se met à jour avec retard.
 */
const requetes = (nanoAiu: number) => Math.round((nanoAiu / 1e9) * 10) / 10;
const horo = () => `[${hms(Date.now() - t0).padStart(6)}]`;
const ligneEtape = (et: ResumeEtape) =>
  `${et.phase} : ${hms(et.duréeMs)}, ${et.tours} tour(s), ${et.rejets.length} rejet(s)` +
  (et.finsAnormales.length ? `, ${et.finsAnormales.length} fin(s) anormale(s)` : "") +
  `, ${et.appels} appel(s), ${requetes(et.nanoAiu)} requête(s) premium`;
let etapeCourante = "";
let suivi = Promise.resolve();
function suivre(e: TraceEntry): void {
  vues.push(e);
  // En série : deux changements d'étape rapprochés ne doivent pas croiser leurs relevés de réserve.
  suivi = suivi.then(async () => {
    if (e.kind === "transition" && e.phase && e.phase !== etapeCourante) {
      const precedente = resumerTrace(vues).etapes.at(-2);
      const reserve = await lireReserve();
      const avant = releves.at(-1)?.restantes;
      const conso = reserve && typeof avant === "number" ? ` (réserve : −${avant - reserve.restantes})` : "";
      if (precedente) console.log(`§ ■ fin ${ligneEtape(precedente)}${conso}`);
      releves.push({ at: e.at, etape: e.phase, restantes: reserve?.restantes ?? null });
      etapeCourante = e.phase;
      console.log(`§ ${horo()} ▶ étape ${e.phase}${e.essais ? ` (essai ${e.essais + 1})` : ""}${reserve ? ` — réserve ${reserve.restantes}/${reserve.total}` : ""}`);
    }
    if (e.kind === "rejet") console.log(`§ ${horo()} ✖ REJET ${etapeCourante} par « ${e.porte} » :\n${e.motifs.slice(0, 5).map((m) => `§      - ${m.slice(0, 220)}`).join("\n")}${e.motifs.length > 5 ? `\n§      (+${e.motifs.length - 5} autres)` : ""}`);
    if (e.kind === "tour-fin" && e.fin !== "output" && e.fin !== "blocker") console.log(`§ ${horo()} ⚠ tour ${e.role?.replace("agent-studio.skraft/", "") ?? "?"} terminé : ${e.fin}${e.raison ? ` (${e.raison.slice(0, 200)})` : ""}`);
    if (e.kind === "tour-fin" && e.fin === "blocker") console.log(`§ ${horo()} ❓ blocage déclaré par ${e.role?.replace("agent-studio.skraft/", "") ?? "?"}`);
    if (e.kind === "transition" && e.événement === "COMMITTED") await pousserBranche("phase commitée");
  });
}
/** Même trace pour le moteur et les agents : le suivi voit transitions, rejets et tours ensemble. */
const trace: TraceStore = {
  async append(e) {
    await traceBrute.append(e);
    suivre(e);
  },
  list: (id) => traceBrute.list(id),
  archive: (id, label, files) => traceBrute.archive(id, label, files),
};
const workspace = await openWorkspace(root);
const usage = createUsageRecorder(join(tasksDir, "usage"));
const engine = createTaskEngine({
  usage,
  store: createJsonTaskStore(tasksDir),
  checkpoints: workspace.checkpoints,
  clock: { now: () => new Date() },
  ids: { next: () => randomUUID() },
  logger,
  trace,
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
/**
 * Escalades déjà relancées, par motif. Le banc répond « relancer » par défaut : face à une panne
 * qui se reproduit à l'identique, il relancerait sans fin. Au troisième motif identique, il abandonne.
 */
const escalades = new Map<string, number>();
const MAX_ESCALADES_IDENTIQUES = 3;
const repondre = async () => {
  for (const q of await interactions.pending()) {
    if (repondues.has(q.id)) continue;
    repondues.add(q.id);
    const texte = `${q.title}\n${q.detail ?? ""}`;
    const voulue = REPONSES.find(([re]) => re.test(texte))?.[1];
    let choix = q.options.find((o) => o.id === voulue || o.label === voulue) ?? q.options[0]!;
    const abandon = q.options.find((o) => o.id === "abort");
    if (abandon && !voulue) {
      const motif = (q.detail ?? q.title).replace(/Request ID: [^)]*/g, "");
      const n = (escalades.get(motif) ?? 0) + 1;
      escalades.set(motif, n);
      if (n >= MAX_ESCALADES_IDENTIQUES) {
        choix = abandon;
        console.log(`§ ✖ même escalade ${n} fois de suite : abandon de la tâche.\n§      ${motif.split("\n")[0]?.slice(0, 200)}`);
      }
    }
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
const agents = createTaskAgentRunner({ runtime, root: workspace.root, logger, trace });
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
  modelFor: (cls) => resolveModel(cls, { classes: classesModeles }),
  clock: { now: () => new Date() },
  ids: { next: () => randomUUID() },
};
if (Object.keys(classesModeles).length) console.log(`Modèles par classe : ${Object.entries(classesModeles).map(([k, v]) => `${k} → ${v}`).join(", ")}`);
await activateInProcess({ manifest, module: skraftExtension, directory: join(process.cwd(), "extensions/skraft") }, hostDeps);

// ---------- Lancement ------------------------------------------------------------------------
// Réserve Copilot AVANT de lancer (ADR 0044) : une tâche skraft consomme des dizaines de requêtes
// premium, et le 29/09 un run a été lancé avec 28 en réserve. Jamais bloquant — seulement dit.
const quota = await lireReserve();
releves.push({ at: new Date().toISOString(), etape: "départ", restantes: quota?.restantes ?? null });
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
await suivi;
await pousserBranche("fin du run");
const reserveFin = await lireReserve();
releves.push({ at: new Date().toISOString(), etape: "fin", restantes: reserveFin?.restantes ?? null });
const resume = resumerTrace(await traceBrute.list(taskId));
const r0 = releves[0]?.restantes;
const consoReelle = typeof r0 === "number" && reserveFin ? r0 - reserveFin.restantes : null;
console.log("\n===== ÉTAPES (lues dans la trace) =====");
console.table(resume.etapes.map((et) => ({ etape: et.phase, duree: hms(et.duréeMs), tours: et.tours, rejets: et.rejets.length, anormales: et.finsAnormales.length, appels: et.appels, requetes: requetes(et.nanoAiu), modeles: et.modèles.join(", "), entree: et.entrée })));
console.log("Par phase :");
console.table(resume.parPhase.map((et) => ({ phase: et.phase, duree: hms(et.duréeMs), tours: et.tours, rejets: et.rejets.length, requetes: requetes(et.nanoAiu), causes: [...new Set(et.rejets.map((r) => r.porte))].join(", ") })));
console.log(
  `Requêtes premium : ${requetes(resume.total.nanoAiu)} d'après le SDK (${resume.total.appels} appels), ` +
    (consoReelle === null ? "réserve illisible." : `écart de réserve ${consoReelle} (${r0} → ${reserveFin!.restantes}, mis à jour avec retard).`),
);

// Rapport versé dans AgentStudio (docs/runs/) : le code produit est sur la branche du projet
// d'essai, l'instrumentation reste ici.
const rapportDir = join(process.cwd(), "docs/runs", `${jour}-${basename(storyPath, ".md").toLowerCase()}-${taskId.slice(0, 8)}`);
await mkdir(rapportDir, { recursive: true });
const md = [
  `# Run skraft — ${basename(storyPath)} — ${jour}`,
  "",
  `- Projet : \`${source}\`${distant ? `, branche poussée \`${brancheRun}\`` : ""}`,
  `- État final : ${state?.stage} / ${state?.phase ?? "—"}`,
  `- Durée : ${hms(Date.now() - t0)}, ${resume.total.tours} tours, ${resume.total.rejets} rejets, ${resume.total.entrée} tokens d'entrée`,
  `- Requêtes premium : ${requetes(resume.total.nanoAiu)} d'après le SDK (${resume.total.appels} appels), écart de réserve ${consoReelle ?? "illisible"}`,
  "",
  "## Étapes",
  "",
  "| Étape | Durée | Tours | Rejets | Fins anormales | Appels | Requêtes premium | Modèles | Tokens entrée |",
  "|---|---|---|---|---|---|---|---|---|",
  ...resume.etapes.map((et) => `| ${et.phase} | ${hms(et.duréeMs)} | ${et.tours} | ${et.rejets.length} | ${et.finsAnormales.map((f) => f.fin).join(", ")} | ${et.appels} | ${requetes(et.nanoAiu)} | ${et.modèles.join(", ")} | ${et.entrée} |`),
  "",
  "## Rejets et leurs motifs",
  "",
  ...resume.etapes.flatMap((et) => et.rejets.flatMap((r) => [`### ${et.phase} — porte « ${r.porte} »`, "", ...r.motifs.map((m) => `- ${m}`), ""])),
  "## Relevés de réserve",
  "",
  ...releves.map((r) => `- ${r.at} — ${r.etape} : ${r.restantes ?? "inconnue"}`),
  "",
].join("\n");
await writeFile(join(rapportDir, "rapport.md"), md);
await writeFile(join(rapportDir, "resume.json"), JSON.stringify({ resume, releves, brancheRun: distant ? brancheRun : null, etatFinal: { stage: state?.stage, phase: state?.phase } }, null, 2));
console.log(`\nRapport : ${join(rapportDir, "rapport.md")}`);
await writeFile(join(tasksDir, "mesure.json"), JSON.stringify({ tours, lignes, state }, null, 2));
console.log(`\nDétail : ${join(tasksDir, "mesure.json")}\nTrace : ${join(tasksDir, "traces", `${taskId}.jsonl`)}\n${enPlace ? "Dépôt (modifié en place)" : "Copie du projet"} : ${root}`);
await agents.releaseTask(taskId);
await runtime.stop();
process.exit(0);
