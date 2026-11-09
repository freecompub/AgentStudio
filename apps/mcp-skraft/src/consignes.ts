/**
 * Les réponses de `/stack init` et `/stack doctor`, rendues par `skraft_pile` (ADR 0075). Leurs consignes
 * nomment des commandes de l'application, que le client MCP n'a pas : on les dit dans les termes de
 * l'outil. Pur. Un test de `skraft_pile` vérifie qu'aucune ne reste.
 */
const OPTION: Record<string, string> = { "--lanceur": "`lanceur`", "--features": "`features`", "--etapes": "`etapes`", "--sans-bdd": "`sansBdd: true`", "--reponse": "`reponse`" };

export function consignesPourLeClient(texte: string): string {
  return texte
    .replace(/Rouvrez le projet pour qu'(il|ils) (prenne|prennent) effet, puis `\/stack doctor` pour voir ce qu'(?:il|ils) (vaut|valent)\./g, (_m, pronom: string, _verbe: string, valoir: string) =>
      `${pronom === "il" ? "Il prend" : "Ils prennent"} effet au prochain appel de skraft ; \`skraft_pile\` avec action « diagnostiquer » dit ce qu'${pronom} ${valoir}.`,
    )
    .replace(/`\/stack doctor`/g, "`skraft_pile` avec action « diagnostiquer »")
    .replace(/`\/stack init (--[a-z-]+)(?: <[^>]+>)?`/g, (m, option: string) => (OPTION[option] ? `\`skraft_pile\` avec ${OPTION[option]}` : m))
    .replace(/`\/stack init`/g, "`skraft_pile`");
}
