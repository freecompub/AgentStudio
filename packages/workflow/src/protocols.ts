/**
 * Workflows rejouables (ADR 0052, `docs/09-workflows-rejouables.md`).
 *
 * Une orchestration est un script ordinaire. Chaque appel vers l'extérieur passe par `w` et est
 * journalisé ; à chaque événement, le script est relancé depuis le début contre son journal :
 * un appel journalisé rend son résultat enregistré, le premier appel absent devient l'effet suivant.
 */
import type { ArchitectureReport, DependencyRule, Evidence, LintReport, MutationReport, TestRun } from "@agent-studio/extension-api";

/** Profils qui peuvent répondre à une question humaine (D6). */
export type Profil = "testeur" | "po" | "developpeur" | "architecte" | "administrateur";

/** Valeur JSON : seul ce qui se sérialise entre dans le journal. */
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Valeur rangée dans le journal : en clair, ou renvoi vers le magasin de contenus. */
export type Range = { clair: Json } | { ref: string };

/** Nature d'une erreur journalisée : elle se relève au rejeu sous la même classe. */
export type NatureErreur = "tour-interrompu" | "panne" | "erreur";

/** Un appel `w.*`, dans l'ordre où le script l'a fait. */
export interface EntreeJournal {
  n: number;
  appel: NomAppel;
  args: Range;
  /** Absent : l'appel est demandé et attend son résultat. */
  resultat?: Range;
  erreur?: { nature: NatureErreur; message: string };
}

/** Appels qui produisent un effet, puis les marqueurs, résolus sans effet. */
export type NomAppel =
  | "agent"
  | "humain"
  | "lireFichier"
  | "listerFichiers"
  | "fichiersModifies"
  | "ecrireFichier"
  | "creerDossier"
  | "lancerTests"
  | "lint"
  | "mutation"
  | "empreinte"
  | "disposition"
  | "preuves"
  | "architecture"
  | "maintenant"
  | "rejet"
  | "etape"
  | "brancher"
  | "checkpoint"
  | "rembobiner"
  | "commiter"
  | "oublier"
  | "informer"
  | "phase";

export type Fin =
  | { statut: "fini"; valeur: Range }
  | { statut: "echec"; motif: string }
  | { statut: "annule" };

/** L'état persisté d'une tâche de workflow (`docs/09` §10). */
export interface EtatWorkflow {
  script: { nom: string; empreinte: string };
  entree: Json;
  journal: EntreeJournal[];
  /** Magasin de contenus, indexé par empreinte : un même contenu n'est stocké qu'une fois. */
  contenus: Record<string, string>;
  fin?: Fin;
  /**
   * Rejets tracés (`w.rejet`), déduits du journal à chaque transition : le moteur les lit pour écrire
   * une entrée `rejet` dans la trace (même convention que les états des réducteurs, ADR 0032).
   */
  rejections?: number;
  /** Étape ou phase en cours, pour la trace (`stade`). */
  stage?: string;
  lastRejection?: { gate: string; reasons: string[] } | null;
}

/** Effet émis vers le moteur : seulement le numéro d'appel, les arguments sont dans le journal. */
export interface EffetWorkflow {
  kind: Exclude<NomAppel, "phase">;
  n: number;
}

export type EvenementWorkflow =
  | { type: "RESULTAT"; n: number; resultat: Json }
  | { type: "ERREUR"; n: number; nature: NatureErreur; message: string };

/** Sortie d'un tour d'agent : la sortie validée de son outil terminal, ou sa question bloquante. */
export type ResultatAgent<S = Record<string, unknown>> =
  | { sortie: S; blocage?: undefined }
  | { sortie?: undefined; blocage: { question: string; choix: string[] } };

export interface OptionsAgent {
  /** Motifs du rejet précédent, ajoutés à la consigne sous « Rejet précédent : » (SPEC §6.6). */
  motifs?: readonly string[];
  /** Motifs interdits en écriture pendant ce tour, en plus du périmètre du rôle (tests gelés). */
  lectureSeule?: readonly string[];
  /** Plus aucune écriture de test après une exécution rouge (D22). */
  gelApresRouge?: boolean;
  /** Rattachement des preuves de l'agent (`run_tests`) : étape (scénario), phase si elle diffère. */
  preuve?: { phase?: string; etape?: string };
}

export interface OptionHumaine {
  id: string;
  label: string;
}

export interface Decision {
  decision: string;
  commentaire?: string;
}

/** L'API du script. Rien d'autre ne sort du script : pas de disque, pas d'heure, pas de hasard. */
export interface W {
  agent<S = Record<string, unknown>>(nom: string, consigne: string, opts?: OptionsAgent): Promise<ResultatAgent<S>>;
  /** `id` désigne la question ; ses profils viennent de la déclaration du workflow, jamais du script. */
  humain(id: string, question: string, options: readonly OptionHumaine[], opts?: { detail?: string; texteLibre?: boolean }): Promise<Decision>;
  lireFichier(chemin: string): Promise<string>;
  listerFichiers(): Promise<string[]>;
  /** `removed` : lignes de l'ancien contenu retirées ou remplacées (zéro : ajouts seulement). */
  fichiersModifies(depuis: string): Promise<{ path: string; status: "added" | "modified" | "deleted"; lines?: number[]; removed?: number }[]>;
  ecrireFichier(chemin: string, contenu: string): Promise<void>;
  creerDossier(chemin: string): Promise<void>;
  /** Tests du projet par le cœur : la preuve est enregistrée sous `etiquette`, sinon sous la phase en cours (D20). */
  lancerTests(opts?: { etiquette?: string; etape?: string }): Promise<TestRun>;
  /** Preuves de la tâche, dans l'ordre : produites par le cœur, en lecture seule (D20). */
  preuves(): Promise<Evidence[]>;
  /** Contrôle des règles de dépendance entre modules ; `null` si la stack ne sait pas l'analyser. */
  architecture(regles: readonly DependencyRule[]): Promise<ArchitectureReport | null>;
  lint(fichiers?: readonly string[]): Promise<LintReport | null>;
  mutation(): Promise<MutationReport | null>;
  /** Emplacements de la stack du projet (tests d'acceptance, tests unitaires, sources), en motifs. */
  disposition(): Promise<{ acceptanceTests: string[]; unitTests: string[]; sources: string[]; infrastructureModules: string[] }>;
  /** Empreinte des fichiers correspondant aux motifs : geler des tests, puis vérifier le gel (D21). */
  empreinte(motifs: readonly string[]): Promise<string>;
  brancher(nom: string): Promise<void>;
  checkpoint(nom: string): Promise<string>;
  /** Revient au checkpoint et fait oublier les agents qui ont travaillé depuis (ADR 0053). */
  rembobiner(checkpoint: string): Promise<void>;
  commiter(message: string, chemins?: readonly string[]): Promise<string | null>;
  oublier(agents: readonly string[]): Promise<void>;
  informer(texte: string): Promise<void>;
  /**
   * Ouvre une phase (checkpoint), exécute `fn`, commite ; à l'escalade, rembobine et demande.
   * Rend la valeur de `fn`, ou `undefined` si l'humain saute la phase : pour distinguer les deux,
   * `fn` doit rendre une valeur.
   * `apresRembobinage` reprépare ce que le rembobinage efface (dossiers vides que Git ne suit pas).
   * `relance` : vide au premier passage ; après « relancer », les motifs de l'escalade (D15 de docs/12).
   */
  phase<T>(nom: string, fn: (checkpoint: string, relance: readonly string[]) => Promise<T>, opts?: { commit?: string; apresRembobinage?: () => Promise<unknown> }): Promise<T | undefined>;
  /**
   * Trace un essai refusé : la porte (ou la cause) et les motifs exacts. Journalisé sans effet ;
   * `essayer` l'appelle de lui-même. Sert à savoir, après un run, pourquoi chaque travail a été refait.
   */
  rejet(porte: string, motifs: readonly string[]): Promise<void>;
  /**
   * Annonce la sous-étape en cours (évaluation, revue, ratification…) : la phase de la tâche — carte,
   * usage, trace — la suit jusqu'à la prochaine étape ou phase. Journalisé sans effet. Sert à
   * comparer deux implémentations étape par étape (docs/10 §3).
   */
  etape(nom: string): Promise<void>;
  /** Heure courante (ISO 8601), journalisée : identique au rejeu. `Date` n'est pas disponible. */
  maintenant(): Promise<string>;
  /** Termine la tâche en échec, avec ce motif. */
  echec(motif: string): never;
}

export type ScriptWorkflow<E = Json, R = unknown> = (w: W, entree: E) => Promise<R>;

export interface DeclarationWorkflow<E = Json> {
  /** Nom de la tâche dans le moteur. */
  nom: string;
  script: ScriptWorkflow<E>;
  /**
   * Empreinte du fichier de workflow (ADR 0052) : une tâche commencée refuse de reprendre avec un
   * autre script. Absente : empreinte du texte de la fonction `script`.
   */
  empreinte?: string;
  /** Qui peut répondre à quelle question (D6). Une question non déclarée est refusée. */
  humains?: Record<string, readonly Profil[]>;
  /** Agents déclarés (meta du workflow) : un agent absent est refusé à l'appel. Absent : pas de contrôle. */
  agents?: readonly string[];
}
