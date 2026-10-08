import { EnvFailureError, WorkDefectError, type ExtensionContext, type TaskDefinition, type TaskEvent } from "@agent-studio/extension-api";
import { empreinteDe, ranger, relire } from "./contenus.js";
import { rejouer } from "./rejeu.js";
import type { DeclarationWorkflow, EffetWorkflow, EntreeJournal, EtatWorkflow, EvenementWorkflow, Json, NatureErreur, NomAppel } from "./protocols.js";

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
  const empreinte = decl.empreinte ?? empreinteDe(decl.script.toString());

  const effetsDe = (entrees: EntreeJournal[]): EffetWorkflow[] =>
    entrees.filter((e) => !e.resultat && !e.erreur).map((e) => ({ kind: e.appel as EffetWorkflow["kind"], n: e.n }));

  return {
    name: decl.nom,

    async initialState(input) {
      const etat: EtatWorkflow = { script: { nom: decl.nom, empreinte }, entree: (input ?? null) as Json, journal: [], contenus: {} };
      await rejouer(decl, etat);
      return etat;
    },

    initialEffects: (etat) => (etat.fin ? [] : effetsDe(etat.journal)),

    async transition(state, event) {
      const etat = structuredClone(state);
      if (etat.fin) return { state: etat, effects: [] };
      if (etat.script.empreinte !== empreinte) {
        etat.fin = {
          statut: "echec",
          motif: `Le script du workflow a été modifié depuis le début de la tâche (${etat.script.empreinte} → ${empreinte}) : elle ne peut pas reprendre avec lui.`,
        };
        return { state: etat, effects: [] };
      }
      if (event.type === "ABORT") {
        etat.fin = { statut: "annule" };
        return { state: etat, effects: [] };
      }
      appliquer(etat, event);
      const nouveaux = await rejouer(decl, etat);
      return { state: etat, effects: etat.fin ? [] : effetsDe(nouveaux) };
    },

    async runEffect(effet, ctx, { taskId, state, signal }) {
      const entree = state.journal[effet.n - 1];
      if (!entree) throw new Error(`Appel ${effet.n} absent du journal`);
      const args = relire(entree.args, state.contenus) as unknown as Args;
      try {
        const r = await executer(effet.kind, args, { ctx, taskId, state, signal, n: effet.n, decl });
        if (r === ATTENTE) return;
        return { type: "RESULTAT", n: effet.n, resultat: (r ?? null) as Json };
      } catch (err) {
        const nature: NatureErreur = err instanceof WorkDefectError ? "tour-interrompu" : err instanceof EnvFailureError ? "panne" : "erreur";
        return { type: "ERREUR", n: effet.n, nature, message: err instanceof Error ? err.message : String(err) };
      }
    },

    checkpointBefore: (effet) => AVEC_CHECKPOINT.has(effet.kind),
    isTerminal: (etat) => etat.fin !== undefined,
    phaseOf: (etat) => phaseDe(etat),
  };
}

function phaseDe(etat: EtatWorkflow): string {
  for (let i = etat.journal.length - 1; i >= 0; i--) {
    const e = etat.journal[i]!;
    if (e.appel === "phase") return (relire(e.args, etat.contenus) as { nom: string }).nom;
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
}

interface Execution {
  ctx: ExtensionContext;
  taskId: string;
  state: EtatWorkflow;
  signal: AbortSignal;
  n: number;
  decl: DeclarationWorkflow<never>;
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
        evidence,
        ...(a.lectureSeule ? { readOnly: a.lectureSeule } : {}),
        ...(a.gelApresRouge ? { freezeTestsAfterRed: true } : {}),
      });
      return r.blocker ? { blocage: { question: r.blocker.question, choix: r.blocker.choices } } : { sortie: r.output };
    }
    case "humain": {
      const roles = x.decl.humains?.[a.id];
      await ctx.interactions.request({
        taskId,
        title: a.question,
        options: a.options.map((o) => ({ id: `${x.n}:${o.id}`, label: o.label })),
        ...(a.detail ? { detail: a.detail } : {}),
        ...(a.texteLibre ? { freeText: true } : {}),
        ...(roles ? { requiredRoles: [...roles] } : {}),
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
      return ctx.workspace.writeFile(a.chemin, a.contenu);
    case "creerDossier":
      return ctx.workspace.ensureDir(a.chemin);
    case "lancerTests":
      return ctx.stack.runTests({ signal, evidence });
    case "lint":
      return ctx.stack.lint({ signal, ...(a.fichiers ? { files: a.fichiers } : {}) });
    case "mutation":
      return ctx.stack.mutation({ signal });
    case "empreinte":
      return ctx.workspace.fingerprint(a.motifs);
    case "brancher":
      return ctx.git.branch(a.nom);
    case "checkpoint":
      return (await ctx.workspace.checkpoint(a.nom)).id;
    case "rembobiner": {
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
  }
}
