/**
 * Ce qu'un script de workflow importe de `@agent-studio/workflow` (ADR 0055, `docs/11` §8) : les
 * aides, les erreurs, et des **calculs purs** — mêmes entrées, même résultat, aucune E/S. Les
 * contrôles de skraft en ont besoin (empreinte, motifs de fichiers, barre de qualité) ; les donner
 * ici évite que le dossier embarque des modules, et garde le rejeu exact.
 */
import { baselineProblems, bddNonDeclare, coverageForChanges, coreFilesMissing, layerOf, MANIFESTE, matchesAny, parseQualityBar } from "@agent-studio/stack-adapters";
import { disjoncte, memeRefus, normaliserMotifs } from "@agent-studio/core";
import { parse as parseYaml } from "yaml";
import { agir, essayer, motifsInterruption } from "../aides.js";
import { empreinteDe } from "../contenus.js";
import { EchecWorkflow, Escalade, PanneEnvironnement, SauterPhase, TourInterrompu } from "../erreurs.js";

export const bibliotheque = Object.freeze({
  essayer,
  agir,
  motifsInterruption,
  TourInterrompu,
  PanneEnvironnement,
  EchecWorkflow,
  Escalade,
  SauterPhase,
  /** Empreinte sha256 d'un texte : `sha256:<hex>`. */
  empreinte: (texte: string): string => empreinteDe(texte),
  /** Le chemin correspond-il à l'un des motifs (`**`, `*`) ? */
  correspond: (motifs: readonly string[], chemin: string): boolean => matchesAny(motifs, chemin),
  lireYaml: (texte: string): unknown => parseYaml(texte),
  /** Barre de qualité du projet : section `qualite` de `.agent-studio/projet.yaml` (ADR 0071), ou les anciens `quality.yaml` et `.skraft/quality.json`. */
  lireBarreDeQualite: parseQualityBar,
  couchesManquantes: coreFilesMissing,
  coucheDe: layerOf,
  couvertureDuDiff: coverageForChanges,
  problemesTestsExistants: baselineProblems,
  /** BDD non déclaré (08/11) : motifs des composants muets qui en montrent les signes. */
  bddNonDeclare,
  /** Le chemin est-il un manifeste de dépendances (`package.json`, `*.csproj`…) ? */
  estUnManifeste: (chemin: string): boolean => MANIFESTE.test(chemin),
  /** Disjoncteur des réessais (ADR 0073) : même porte, mêmes motifs ; et le préfixe de l'escalade. */
  memeRefus,
  normaliserMotifs,
  disjoncte,
});

export type Bibliotheque = typeof bibliotheque;
