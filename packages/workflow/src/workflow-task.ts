import { EnvFailureError, WorkDefectError, type ExtensionContext, type TaskDefinition, type TaskEvent } from "@agent-studio/extension-api";
import { empreinteDe, ranger, relire } from "./contenus.js";
import { createRejoueurLocal, type Rejoueur } from "./hote/rejoueur.js";
import type { Arbitrage, DeclarationWorkflow, EffetWorkflow, EntreeJournal, EtatWorkflow, EvenementWorkflow, Json, NatureErreur, NomAppel, Profil } from "./protocols.js";

/** Appels qui écrivent ou lancent un agent : checkpoint avant (D23). */
const AVEC_CHECKPOINT = new Set<NomAppel>(["agent", "ecrireFichier", "creerDossier", "commiter", "brancher"]);

/** L'effet a demandé une réponse humaine : rien à rendre, la décision arrivera par `HUMAN_DECISION`. */
const ATTENTE = Symbol("attente");

/**
 * Définition de tâche générique pour un workflow (ADR 0052) : implémente le `TaskDefinition`
 * existant, donc le moteur garde la persistance après chaque transition, le checkpoint avant chaque
 * effet et la reprise d'un effet interrompu. L'état est le journal.
 */
export function createWorkflowTask<E>(declaration: DeclarationWorkflow<E>): TaskDefinition<EtatWorkflow, EvenementWorkflow, EffetWorkflow, ExtensionContext> {
  const decl = declaration as unknown as DeclarationWorkflow<never>;
  return createWorkflowTaskDepuis({
    nom: decl.nom,
    empreinte: decl.empreinte ?? empreinteDe(decl.script.toString()),
    ...(decl.humains ? { humains: decl.humains } : {}),
    rejoueur: createRejoueurLocal(decl),
  });
}

export interface OptionsTache {
  nom: string;
  /** Empreinte du script (ou du dossier du workflow) : une tâche refuse de reprendre avec un autre. */
  empreinte: string;
  /** Profils autorisés par question humaine (meta du workflow). */
  humains?: Record<string, readonly Profil[]>;
  /** Qui rejoue le script : dans ce processus, ou dans un processus isolé (`docs/11` §8). */
  rejoueur: Rejoueur;
  /** Workflow en dossier : un refus de permission se dit en termes du `meta` (ADR 0055). */
  refusEnTermesDuMeta?: boolean;
}

/** Définition de tâche à partir d'un rejoueur : le script peut tourner hors de ce processus. */
export function createWorkflowTaskDepuis(o: OptionsTache): TaskDefinition<EtatWorkflow, EvenementWorkflow, EffetWorkflow, ExtensionContext> {
  const { empreinte } = o;
  const effetsDe = (entrees: EntreeJournal[]): EffetWorkflow[] =>
    entrees.filter((e) => !e.resultat && !e.erreur).map((e) => ({ kind: e.appel as EffetWorkflow["kind"], n: e.n }));

  return {
    name: o.nom,

    async initialState(input) {
      const etat: EtatWorkflow = { script: { nom: o.nom, empreinte }, entree: (input ?? null) as Json, journal: [], contenus: {} };
      return avecRejets((await o.rejoueur.rejouer(etat)).etat);
    },

    initialEffects: (etat) => (etat.fin ? [] : effetsDe(etat.journal)),

    async transition(state, event) {
      const etat = structuredClone(state);
      if (etat.fin) return { state: etat, effects: [] };
      if (etat.script.empreinte !== empreinte) {
        etat.fin = {
          statut: "echec",
          motif: `Le workflow a été modifié depuis le début de la tâche (${etat.script.empreinte} → ${empreinte}) : elle ne peut pas reprendre avec lui. Relance-la avec la nouvelle version.`,
        };
        return { state: etat, effects: [] };
      }
      if (event.type === "ABORT") {
        etat.fin = { statut: "annule" };
        return { state: etat, effects: [] };
      }
      appliquer(etat, event);
      const r = await o.rejoueur.rejouer(etat);
      return { state: avecRejets(r.etat), effects: r.etat.fin ? [] : effetsDe(r.nouveaux) };
    },

    async runEffect(effet, ctx, { taskId, state, signal }) {
      const entree = state.journal[effet.n - 1];
      if (!entree) throw new Error(`Appel ${effet.n} absent du journal`);
      const args = relire(entree.args, state.contenus) as unknown as Args;
      try {
        const r = await executer(effet.kind, args, { ctx, taskId, state, signal, n: effet.n, humains: o.humains });
        if (r === ATTENTE) return;
        return { type: "RESULTAT", n: effet.n, resultat: (r ?? null) as Json };
      } catch (err) {
        const nature: NatureErreur = err instanceof WorkDefectError ? "tour-interrompu" : err instanceof EnvFailureError ? "panne" : "erreur";
        const permission = o.refusEnTermesDuMeta && err instanceof Error && err.name === "PermissionDeniedError" ? (err as { permission?: string }).permission : undefined;
        const message = permission ? `${permission} : action non déclarée dans meta.permissions du workflow` : err instanceof Error ? err.message : String(err);
        return { type: "ERREUR", n: effet.n, nature, message };
      }
    },

    checkpointBefore: (effet) => AVEC_CHECKPOINT.has(effet.kind),
    // Le workflow rend ses erreurs comme événements : la trace des effets doit les voir (docs/10 P2).
    estUnEchec: (e) => e.type === "ERREUR",
    isTerminal: (etat) => etat.fin !== undefined,
    phaseOf: (etat) => phaseDe(etat),
  };
}

/** `rejections` et `lastRejection` déduits des appels `w.rejet` du journal (convention du moteur). */
function avecRejets(etat: EtatWorkflow): EtatWorkflow {
  const rejets = etat.journal.filter((e) => e.appel === "rejet");
  const dernier = rejets.at(-1);
  const args = dernier ? (relire(dernier.args, etat.contenus) as { porte: string; motifs: string[] }) : null;
  const arbitrages = etat.journal.filter((e) => e.appel === "arbitrage").map((e) => relire(e.args, etat.contenus) as unknown as Arbitrage);
  return { ...etat, rejections: rejets.length, lastRejection: args ? { gate: args.porte, reasons: args.motifs } : null, arbitrages, stage: phaseDe(etat) };
}

/** La dernière phase ou étape annoncée (`w.phase`, `w.etape`), sinon « DÉBUT ». */
function phaseDe(etat: EtatWorkflow): string {
  for (let i = etat.journal.length - 1; i >= 0; i--) {
    const e = etat.journal[i]!;
    if (e.appel === "phase" || e.appel === "etape") return (relire(e.args, etat.contenus) as { nom: string }).nom;
  }
  return "DÉBUT";
}

/** Range l'événement dans l'entrée du journal qui l'attendait. */
function appliquer(etat: EtatWorkflow, event: TaskEvent<EvenementWorkflow>): void {
  const attente = (n: number) => {
    const e = etat.journal[n - 1];
    return e && !e.resultat && !e.erreur ? e : undefined;
  };
  switch (event.type) {
    case "RESULTAT": {
      const e = attente(event.n);
      if (e) e.resultat = ranger(event.resultat, etat.contenus);
      return;
    }
    case "ERREUR": {
      const e = attente(event.n);
      if (e) e.erreur = { nature: event.nature, message: event.message };
      return;
    }
    case "HUMAN_DECISION": {
      // Les options portent le numéro d'appel (`<n>:<option>`) : plusieurs questions peuvent
      // attendre en même temps (ratifications), chaque réponse retrouve la sienne.
      const sep = event.decision.indexOf(":");
      const n = Number(event.decision.slice(0, sep));
      const e = sep > 0 ? attente(n) : etat.journal.filter((x) => x.appel === "humain" && attente(x.n)).at(0);
      if (!e || e.appel !== "humain") return;
      const decision = sep > 0 ? event.decision.slice(sep + 1) : event.decision;
      e.resultat = ranger({ decision, ...(event.comment ? { commentaire: event.comment } : {}) }, etat.contenus);
      return;
    }
    case "TIMEOUT":
    case "ENV_FAILURE": {
      // Normalement impossible : `runEffect` rend lui-même ses erreurs. Par prudence, l'erreur va
      // au plus ancien appel en attente qui n'est pas une question humaine.
      const e = etat.journal.find((x) => x.appel !== "humain" && attente(x.n));
      if (e) e.erreur = { nature: event.type === "TIMEOUT" ? "tour-interrompu" : "panne", message: event.reason };
      return;
    }
    default:
      return; // RESUMED : rien de neuf, le rejeu suffit
  }
}

/** Arguments journalisés des appels, tels que `rejeu.ts` les écrit. */
interface Args {
  nom: string;
  consigne: string;
  lectureSeule?: string[];
  gelApresRouge?: boolean;
  id: string;
  question: string;
  options: { id: string; label: string }[];
  detail?: string;
  texteLibre?: boolean;
  chemin: string;
  contenu: string;
  depuis: string;
  fichiers?: string[];
  motifs: string[];
  checkpoint: string;
  message: string;
  chemins?: string[];
  agents: string[];
  texte: string;
  etiquette?: string;
  etape?: string;
  preuve?: { phase?: string; etape?: string };
  regles: { module: string; forbidden: string[] }[];
}

/** Le dossier d'un workflow est gelé, pour le script comme pour les agents (ADR 0055). */
function gele(chemin: string): void {
  const s = chemin.replace(/\\/g, "/").replace(/^\.\//, "").split("/").map((x) => x.toLowerCase());
  if (s[0] === ".agent-studio" && s[1] === "workflows") throw new Error(`Écriture refusée : ${chemin} est dans le dossier d'un workflow, gelé pendant la tâche.`);
}

interface Execution {
  ctx: ExtensionContext;
  taskId: string;
  state: EtatWorkflow;
  signal: AbortSignal;
  n: number;
  humains: Record<string, readonly Profil[]> | undefined;
}

/** Agents lancés depuis un checkpoint, dans l'ordre de leur premier tour (ADR 0053). */
export function agentsDepuis(etat: EtatWorkflow, checkpoint: string): string[] {
  const i = etat.journal.findIndex((e) => e.appel === "checkpoint" && e.resultat && relire(e.resultat, etat.contenus) === checkpoint);
  if (i < 0) return [];
  const noms = etat.journal
    .slice(i + 1)
    .filter((e) => e.appel === "agent")
    .map((e) => (relire(e.args, etat.contenus) as { nom: string }).nom);
  return [...new Set(noms)];
}

async function executer(kind: EffetWorkflow["kind"], a: Args, x: Execution): Promise<unknown> {
  const { ctx, taskId, signal } = x;
  const evidence = { taskId, phase: phaseDe(x.state) };
  switch (kind) {
    case "agent": {
      const r = await ctx.agents.run(a.nom, a.consigne, {
        signal,
        evidence: { ...evidence, ...(a.preuve?.phase ? { phase: a.preuve.phase } : {}), ...(a.preuve?.etape ? { stepId: a.preuve.etape } : {}) },
        ...(a.lectureSeule ? { readOnly: a.lectureSeule } : {}),
        ...(a.gelApresRouge ? { freezeTestsAfterRed: true } : {}),
      });
      return r.blocker ? { blocage: { question: r.blocker.question, choix: r.blocker.choices } } : { sortie: r.output };
    }
    case "humain": {
      const roles = x.humains?.[a.id];
      await ctx.interactions.request({
        taskId,
        title: a.question,
        options: a.options.map((o) => ({ id: `${x.n}:${o.id}`, label: o.label })),
        ...(a.detail ? { detail: a.detail } : {}),
        ...(a.texteLibre ? { freeText: true } : {}),
        ...(roles?.length ? { requiredRoles: [...roles] } : {}),
      });
      return ATTENTE;
    }
    case "lireFichier":
      return ctx.workspace.readFile(a.chemin);
    case "listerFichiers":
      return ctx.workspace.listFiles();
    case "fichiersModifies":
      return ctx.workspace.changedFiles(a.depuis);
    case "ecrireFichier":
      gele(a.chemin);
      return ctx.workspace.writeFile(a.chemin, a.contenu);
    case "creerDossier":
      gele(a.chemin);
      return ctx.workspace.ensureDir(a.chemin);
    case "lancerTests":
      return ctx.stack.runTests({ signal, evidence: { ...evidence, ...(a.etiquette ? { phase: a.etiquette } : {}), ...(a.etape ? { stepId: a.etape } : {}) } });
    case "preuves":
      return ctx.evidence.list(taskId);
    case "architecture":
      return ctx.stack.architecture(a.regles);
    case "lint":
      return ctx.stack.lint({ signal, ...(a.fichiers ? { files: a.fichiers } : {}) });
    case "format":
      return ctx.stack.format({ signal, ...(a.fichiers ? { files: a.fichiers } : {}) });
    case "mutation":
      return ctx.stack.mutation({ signal });
    case "empreinte":
      return ctx.workspace.fingerprint(a.motifs);
    case "disposition": {
      const { acceptanceTests, unitTests, sources } = ctx.stack.layout;
      return { pile: ctx.stack.id, acceptanceTests, unitTests, sources, infrastructureModules: [...ctx.stack.infrastructureModules], ...(ctx.stack.bdd ? { bdd: ctx.stack.bdd.map((c) => ({ ...c })) } : {}), ...(ctx.stack.bddNonDecide ? { bddNonDecide: [...ctx.stack.bddNonDecide] } : {}) };
    }
    case "brancher":
      return ctx.git.branch(a.nom);
    case "checkpoint":
      return (await ctx.workspace.checkpoint(a.nom)).id;
    case "rembobiner": {
      // Archiver AVANT (ADR 0038) : le rembobinage efface le livrable avec le verdict qui le
      // condamne. La trace raconte ; elle n'atteste rien, et son échec n'arrête rien.
      const effaces = await ctx.workspace.changedFiles(a.checkpoint).catch(() => []);
      const livrables = await Promise.all(
        effaces.filter((f) => f.status !== "deleted").map(async (f) => ({ path: f.path, content: await ctx.workspace.readFile(f.path).catch(() => "") })),
      );
      if (livrables.length) await ctx.trace.rejected(taskId, `${phaseDe(x.state)} rembobinage`, livrables).catch(() => undefined);
      await ctx.workspace.rollback(a.checkpoint);
      const agents = agentsDepuis(x.state, a.checkpoint);
      if (agents.length) await ctx.agents.forget(taskId, agents);
      return null;
    }
    case "commiter":
      return ctx.git.commit(a.message, a.chemins ? { paths: a.chemins } : undefined);
    case "oublier":
      return ctx.agents.forget(taskId, a.agents);
    case "informer":
      return ctx.chat.post(a.texte);
    case "maintenant":
      return new Date().toISOString();
  }
}
