import { canon, ranger, relire } from "./contenus.js";
import { EchecWorkflow, Escalade, PanneEnvironnement, SauterPhase, TourInterrompu } from "./erreurs.js";
import type { DeclarationWorkflow, EntreeJournal, EtatWorkflow, Fin, NatureErreur, NomAppel, OptionHumaine, W } from "./protocols.js";

/** Promesse qui ne se résout jamais : l'appel attend son résultat, le script s'arrête là. */
const jamais = <T>(): Promise<T> => new Promise<T>(() => {});

export function versErreur(e: { nature: NatureErreur; message: string }): Error {
  if (e.nature === "tour-interrompu") return new TourInterrompu(e.message);
  if (e.nature === "panne") return new PanneEnvironnement(e.message);
  return new Error(e.message);
}

const description = (appel: string, args: unknown) => `${appel}(${canon(args).slice(0, 200)})`;

/**
 * Relance le script depuis le début contre le journal de `etat` (`docs/09` §6.2).
 *
 * - un appel présent avec les mêmes arguments rend son résultat (ou relève son erreur) ;
 * - un appel présent avec d'autres arguments arrête tout : non-déterminisme ;
 * - un appel absent est inscrit comme demandé, et ne se résout pas.
 *
 * Mute `etat` (journal, contenus, fin) ; rend les entrées nouvellement inscrites.
 */
export async function rejouer(decl: DeclarationWorkflow<never>, etat: EtatWorkflow): Promise<EntreeJournal[]> {
  const { journal, contenus } = etat;
  const nouveaux: EntreeJournal[] = [];
  let compteur = 0;
  let divergence: string | undefined;

  const appeler = <T>(appel: NomAppel, args: unknown, marqueur = false): Promise<T> => {
    const n = ++compteur;
    if (divergence) return jamais();
    const ranges = ranger(args, contenus);
    const e = journal[n - 1];
    if (e) {
      if (e.appel !== appel || canon(e.args) !== canon(ranges)) {
        divergence = `Non-déterminisme : l'appel ${n} était ${description(e.appel, relire(e.args, contenus))}, le script demande maintenant ${description(appel, args)}. Le script doit faire les mêmes appels à chaque rejeu (pas d'heure, de hasard ni d'état extérieur).`;
        return jamais();
      }
      if (e.resultat) return Promise.resolve(relire(e.resultat, contenus) as T);
      if (e.erreur) return Promise.reject(versErreur(e.erreur));
      return jamais();
    }
    const entree: EntreeJournal = { n, appel, args: ranges, ...(marqueur ? { resultat: { clair: null } } : {}) };
    journal.push(entree);
    nouveaux.push(entree);
    return marqueur ? Promise.resolve(null as T) : jamais();
  };

  const w: W = {
    agent: async (nom, consigne, opts = {}) => {
      if (decl.agents && !decl.agents.includes(nom)) throw new Error(`Agent « ${nom} » non déclaré dans le meta du workflow ${decl.nom}`);
      return appeler("agent", {
        nom,
        consigne: opts.motifs?.length ? `${consigne}\n\nRejet précédent :\n${opts.motifs.map((m) => `  - ${m}`).join("\n")}` : consigne,
        ...(opts.lectureSeule?.length ? { lectureSeule: [...opts.lectureSeule] } : {}),
        ...(opts.gelApresRouge ? { gelApresRouge: true } : {}),
        ...(opts.preuve ? { preuve: { ...opts.preuve } } : {}),
      });
    },
    humain: async (id, question, options, opts = {}) => {
      if (decl.humains && !(id in decl.humains)) throw new Error(`Question humaine « ${id} » non déclarée dans le workflow ${decl.nom}`);
      return appeler("humain", { id, question, options: options.map((o) => ({ id: o.id, label: o.label })), ...opts });
    },
    lireFichier: (chemin) => appeler("lireFichier", { chemin }),
    listerFichiers: () => appeler("listerFichiers", {}),
    fichiersModifies: (depuis) => appeler("fichiersModifies", { depuis }),
    ecrireFichier: (chemin, contenu) => appeler("ecrireFichier", { chemin, contenu }),
    creerDossier: (chemin) => appeler("creerDossier", { chemin }),
    lancerTests: (opts = {}) => appeler("lancerTests", { ...(opts.etiquette ? { etiquette: opts.etiquette } : {}), ...(opts.etape ? { etape: opts.etape } : {}) }),
    preuves: () => appeler("preuves", {}),
    architecture: (regles) => appeler("architecture", { regles: regles.map((r) => ({ ...r })) }),
    lint: (fichiers) => appeler("lint", fichiers ? { fichiers: [...fichiers] } : {}),
    mutation: () => appeler("mutation", {}),
    empreinte: (motifs) => appeler("empreinte", { motifs: [...motifs] }),
    disposition: () => appeler("disposition", {}),
    brancher: (nom) => appeler("brancher", { nom }),
    checkpoint: (nom) => appeler("checkpoint", { nom }),
    rembobiner: (checkpoint) => appeler("rembobiner", { checkpoint }),
    commiter: (message, chemins) => appeler("commiter", { message, ...(chemins ? { chemins: [...chemins] } : {}) }),
    oublier: (agents) => appeler("oublier", { agents: [...agents] }),
    informer: (texte) => appeler("informer", { texte }),
    maintenant: () => appeler("maintenant", {}),
    rejet: (porte, motifs) => appeler("rejet", { porte, motifs: [...motifs] }, true),
    echec: (motif) => {
      throw new EchecWorkflow(motif);
    },
    phase: async (nom, fn, opts = {}) => {
      await appeler("phase", { nom }, true);
      // Une phase s'ouvre une fois : un réessai ne repose pas son checkpoint (docs/09 §5.2).
      const cp = await w.checkpoint(nom);
      for (;;) {
        let motif: string;
        try {
          const v = await fn(cp);
          if (opts.commit) await w.commiter(opts.commit);
          return v;
        } catch (e) {
          if (e instanceof SauterPhase) {
            await w.rembobiner(cp);
            await opts.apresRembobinage?.();
            return undefined;
          }
          if (e instanceof Escalade) motif = e.message;
          else if (e instanceof PanneEnvironnement) motif = `panne d'environnement : ${e.message}`;
          else throw e;
        }
        // L'escalade annule toujours (ADR 0040) ; les agents de la phase oublient (ADR 0053).
        await w.rembobiner(cp);
        await opts.apresRembobinage?.();
        const d = await w.humain("escalade", `Phase ${nom} : ${motif}`, ESCALADE);
        if (d.decision === "sauter") return undefined;
        if (d.decision === "abandonner") w.echec(`Phase ${nom} abandonnée : ${motif}`);
      }
    },
  };

  let issue: { ok: unknown } | { err: unknown } | undefined;
  void Promise.resolve()
    .then(() => decl.script(w, structuredClone(etat.entree) as never))
    .then(
      (ok) => void (issue = { ok }),
      (err: unknown) => void (issue = { err }),
    );
  // Tout ce que le script attend est soit déjà journalisé (microtâches), soit jamais résolu : il
  // suffit d'attendre que plus aucun appel n'arrive d'un tour de boucle à l'autre.
  for (let avant = -1; issue === undefined && avant !== compteur; ) {
    avant = compteur;
    await new Promise((r) => setImmediate(r));
  }

  if (!divergence && issue && compteur < journal.length)
    divergence = `Non-déterminisme : le script s'est terminé après ${compteur} appels, le journal en compte ${journal.length}.`;
  if (divergence) etat.fin = { statut: "echec", motif: divergence };
  else if (issue) etat.fin = finDe(issue, contenus);
  return nouveaux;
}

function finDe(issue: { ok: unknown } | { err: unknown }, contenus: Record<string, string>): Fin {
  if ("ok" in issue) return { statut: "fini", valeur: ranger(issue.ok, contenus) };
  const err = issue.err;
  if (err instanceof EchecWorkflow) return { statut: "echec", motif: err.motif };
  return { statut: "echec", motif: `Erreur du script : ${err instanceof Error ? err.message : String(err)}` };
}

const ESCALADE: readonly OptionHumaine[] = [
  { id: "relancer", label: "Relancer la phase" },
  { id: "sauter", label: "Sauter la phase" },
  { id: "abandonner", label: "Abandonner la tâche" },
];
