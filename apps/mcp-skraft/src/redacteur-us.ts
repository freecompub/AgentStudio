/**
 * L'agent qui met en forme une US GitHub en story skraft (ADR 0078). Il n'écrit que le fichier de la
 * story ; le code la vérifie ensuite (format, identifiant, aucune valeur inventée, `us-github.ts`).
 */
import type { TaskAgentRunner } from "@agent-studio/core";
import type { MiseEnForme } from "./us-github.js";

export const ROLE_REDACTEUR_US = "skraft-redacteur-us";

export const PROMPT_REDACTEUR_US = `Tu mets en forme une user story tenue dans une issue GitHub, pour qu'elle puisse être livrée.
Tu écris un seul fichier, la story, au format suivant :

# <IDENTIFIANT> — <titre>

<l'énoncé : qui, quoi, pourquoi, en quelques phrases>

## Critères d'acceptation

1. <un comportement observable, vérifiable par un test>
2. …

## Questions ouvertes

- <ce que l'issue ne tranche pas>

Règles :
- Reprends les critères de l'issue. Les commentaires font partie de l'US : une décision prise dans un
  commentaire précise ou remplace ce que dit l'issue.
- Recopie mot pour mot les valeurs (montants, seuils, textes, noms) depuis l'issue ou ses
  commentaires. Le code refuse toute valeur d'un critère qui n'y figure pas.
- Les issues liées (parente, sous-issues, bloquantes, citées) sont du contexte : ne leur prends pas
  leurs critères.
- Ce que l'issue ne tranche pas va dans « Questions ouvertes », avec les réponses possibles si tu les
  vois. N'invente rien pour combler un manque.
- Un critère par comportement, numérotés à partir de 1.

Quand le fichier est écrit, rends la main.`;

export function createMiseEnFormeParAgent(o: { agents(): Promise<TaskAgentRunner>; modele?(): Promise<string | undefined> }): MiseEnForme {
  return async (e) => {
    const prompt = [
      `Identifiant de la story : ${e.identifiant}. Écris-la dans \`${e.chemin}\`, son titre commençant par « # ${e.identifiant} — ».`,
      "# Ce que le code a lu sur GitHub",
      e.contexte,
      ...(e.precedent ? ["# Ta story précédente a été refusée", "Motifs, à corriger dans le fichier :", e.precedent.motifs.map((m) => `- ${m}`).join("\n")] : []),
    ].join("\n\n");
    try {
      const modele = await o.modele?.();
      const r = await (await o.agents()).run({ role: ROLE_REDACTEUR_US, systemPrompt: PROMPT_REDACTEUR_US, writable: [e.chemin], output: "report_phase", ...(modele ? { model: modele } : {}) }, prompt);
      return r.blocker ? { erreur: `l'agent a posé une question : ${r.blocker.question}` } : { ok: true };
    } catch (err) {
      return { erreur: err instanceof Error ? err.message : String(err) };
    }
  };
}
