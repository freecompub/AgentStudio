/**
 * Skill d'architecture transmise à l'appel de skraft (`/skraft <story> --archi <nom>`). Les skills
 * par langage sont reprises de skraft-plugin v1.15.1 (`plugins/skraft-framework/skills/
 * clean-architecture-*`) ; elles appliquent à un écosystème les règles de couches de
 * `architecture-patterns`, qui est la clean architecture par défaut : sans argument, ou si le nom est
 * inconnu. Pur.
 */
export const ARCHITECTURE_PAR_DEFAUT = "architecture-patterns";
export const SKILLS_D_ARCHITECTURE = ["clean-architecture-dotnet", "clean-architecture-java", "clean-architecture-python", "clean-architecture-react"] as const;

/** Skill retenue pour un argument `--archi` : son nom complet, ou le seul langage. */
export function skillDArchitecture(demande: string | null | undefined): { skill: string; avertissement?: string } {
  const nom = demande?.trim().toLowerCase() ?? "";
  if (!nom) return { skill: ARCHITECTURE_PAR_DEFAUT };
  const trouvee = SKILLS_D_ARCHITECTURE.find((s) => s === nom || s === `clean-architecture-${nom}`);
  if (trouvee) return { skill: trouvee };
  return {
    skill: ARCHITECTURE_PAR_DEFAUT,
    avertissement: `Skill d'architecture « ${demande} » inconnue : skraft utilise la clean architecture par défaut (${ARCHITECTURE_PAR_DEFAUT}). Connues : ${SKILLS_D_ARCHITECTURE.join(", ")}.`,
  };
}

/** Ligne du dossier de passation de DESIGN, DISTILL et DELIVER. */
export function ligneArchitecture(skill: string): string {
  return skill === ARCHITECTURE_PAR_DEFAUT
    ? `Architecture du projet : clean architecture par défaut, skill \`${ARCHITECTURE_PAR_DEFAUT}\`.`
    : `Architecture du projet : charge la skill \`${skill}\` ; ses règles de couches sont celles de \`${ARCHITECTURE_PAR_DEFAUT}\`.`;
}
