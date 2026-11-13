/**
 * Workflows rejouables (ADR 0052, `docs/09-workflows-rejouables.md`).
 *
 * Une orchestration est un script ordinaire. Chaque appel vers l'extérieur passe par `w` et est
 * journalisé ; à chaque événement, le script est relancé depuis le début contre son journal :
 * un appel journalisé rend son résultat enregistré, le premier appel absent devient l'effet suivant.
 */
import type { ArchitectureReport, DependencyRule, Evidence, FormatReport, LintReport, MutationReport, TestRun } from "@agent-studio/extension-api";

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
  | "format"
  | "mutation"
  | "empreinte"
  | "disposition"
  | "preuves"
  | "architecture"
  | "maintenant"
  | "rejet"
  | "arbitrage"
  | "etape"
  | "brancher"
  | "tete"
  | "historique"
  | "revenirA"
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
  /** Arbitrages tracés (`w.arbitrage`), déduits du journal : le moteur les écrit dans la trace. */
  arbitrages?: Arbitrage[];
}

/** Arbitrage d'un défaut de porte contesté (ADR 0065). */
export interface Arbitrage {
  porte: string;
  élément: string;
  contestation: string;
  décision: "dérogation" | "à corriger" | "obsolète";
  par: "agent" | "humain";
  raison: string;
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
export type ResultatAgent<S = Record<string, unknown>> = (
  | { sortie: S; blocage?: undefined }
  | { sortie?: undefined; blocage: { question: string; choix: string[] } }
) & {
  /** Vérifications faites par l'agent pendant son tour (ADR 0082) : nombre d'appels, dernière réponse. */
  verification?: { appels: number; dernier?: string };
};

export interface OptionsAgent {
  /** Motifs du rejet précédent, ajoutés à la consigne sous « Rejet précédent : » (SPEC §6.6). */
  motifs?: readonly string[];
  /** Motifs interdits en écriture pendant ce tour, en plus du périmètre du rôle (tests gelés). */
  lectureSeule?: readonly string[];
  /** Plus aucune écriture de test après une exécution rouge (D22). */
  gelApresRouge?: boolean;
  /** Rattachement des preuves de l'agent (`run_tests`) : étape (scénario), phase si elle diffère. */
  preuve?: { phase?: string; etape?: string };
  /**
   * L'outil du workflow avec lequel l'agent vérifie son travail, celui que la porte rejoue (ADR 0082) :
   * il reçoit les fichiers désignés, lus par l'hôte, et `donnees`. Sans vérification depuis sa
   * dernière modification de ces fichiers, la sortie de l'agent est refusée une fois.
   */
  verification?: { outil: string; fichiers: readonly string[]; donnees?: Json };
}

/** Ce que reçoit un outil apporté par un workflow (ADR 0082). */
export interface EntreeOutil {
  /** Arguments passés par l'agent. */
  args: unknown;
  /** Fichiers désignés par la vérification du tour, lus par l'hôte : chemin → contenu. */
  fichiers: Record<string, string>;
  donnees?: Json;
  /**
   * Lecture à la demande, servie par l'hôte : le contenu d'un fichier de la liste du dépôt, celle que
   * voit le script (`w.listerFichiers`), ou `null`. Pour une porte qui ne sait qu'après lecture ce
   * qu'elle doit lire (les fichiers cités par une recherche).
   */
  lire(chemin: string): Promise<string | null>;
}

/** Les outils qu'un workflow apporte à ses agents : fonctions sans effet, exportées par le script (`outils`). */
export type OutilsWorkflow = Record<string, (entree: EntreeOutil) => string | Promise<string>>;

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
  /** Mise en forme vérifiée par l'outil du projet (ADR 0071) ; `null` si le profil n'en déclare pas. */
  format(fichiers?: readonly string[]): Promise<FormatReport | null>;
  mutation(): Promise<MutationReport | null>;
  /** Pile du projet (identifiant de l'adaptateur) et ses emplacements (tests d'acceptance, tests unitaires, sources), en motifs. */
  /**
   * Emplacements de la pile ; `bdd`, ses couples quand elle en déclare (ADR 0074) ; `bddNonDecide`, les
   * racines des composants dont la pile ne dit rien du BDD (08/11).
   */
  disposition(): Promise<{ pile: string; acceptanceTests: string[]; unitTests: string[]; sources: string[]; infrastructureModules: string[]; bdd?: { lanceur: string; features: string; etapes: string }[]; bddNonDecide?: string[] }>;
  /** Empreinte des fichiers correspondant aux motifs : geler des tests, puis vérifier le gel (D21). */
  empreinte(motifs: readonly string[]): Promise<string>;
  /** Se place sur la branche, créée si besoin ; `ecraser` : la recrée depuis `depuis` (ou la tête), ce qu'elle portait est perdu (ADR 0089). */
  brancher(nom: string, opts?: { depuis?: string; ecraser?: boolean }): Promise<void>;
  /** Commit de tête de la branche courante. */
  tete(): Promise<string>;
  /** Commits de la branche courante, du plus récent au plus ancien. */
  historique(): Promise<{ sha: string; subject: string }[]>;
  /** Ramène la branche à un commit de son historique ; rend les fichiers non suivis laissés en place (ADR 0089). */
  revenirA(sha: string): Promise<{ nonSuivis: string[] }>;
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
  phase<T>(
    nom: string,
    fn: (checkpoint: string, relance: readonly string[]) => Promise<T>,
    opts?: { commit?: string; apresRembobinage?: () => Promise<unknown>; /** Commit en échec, continué sans commit par l'humain (D19 de docs/12). */ commitManque?: (motif: string) => void },
  ): Promise<T | undefined>;
  /**
   * Trace un essai refusé : la porte (ou la cause) et les motifs exacts. Journalisé sans effet ;
   * `essayer` l'appelle de lui-même. Sert à savoir, après un run, pourquoi chaque travail a été refait.
   */
  rejet(porte: string, motifs: readonly string[]): Promise<void>;
  /**
   * Trace l'arbitrage d'un défaut de porte contesté (ADR 0065) : qui a tranché, quoi, pourquoi.
   * Journalisé sans effet ; le moteur l'écrit dans la trace.
   */
  arbitrage(a: Arbitrage): Promise<void>;
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
  /** Outils apportés par le workflow (ADR 0082), exécutés à la demande de l'hôte. */
  outils?: OutilsWorkflow;
}
