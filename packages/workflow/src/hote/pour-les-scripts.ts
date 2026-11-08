/**
 * `@agent-studio/workflow` tel qu'un script de workflow le voit : exactement la bibliothèque que le
 * bac à sable lui fournit (`bibliotheque.ts`), en exports nommés. Sert à tester les modules d'un
 * workflow hors du processus isolé (alias Vitest) ; jamais importé par la plateforme elle-même.
 */
import { bibliotheque } from "./bibliotheque.js";

export const {
  essayer,
  agir,
  motifsInterruption,
  TourInterrompu,
  PanneEnvironnement,
  EchecWorkflow,
  Escalade,
  SauterPhase,
  empreinte,
  correspond,
  lireYaml,
  lireBarreDeQualite,
  couchesManquantes,
  coucheDe,
  // Revue de la PR #12 : absents, ils valaient `undefined` dans les tests du workflow.
  couvertureDuDiff,
  problemesTestsExistants,
  bddNonDeclare,
  estUnManifeste,
  memeRefus,
  disjoncte,
} = bibliotheque;
