import { LANCEURS_BDD, LECTEURS_PAR_SECTION, type ParseOptions } from "@agent-studio/stack-adapters";
import type { Logger, TaskAgentRunner } from "@agent-studio/core";
import type { Decouverte, DemandeDecouverte, ReponseDecouverte } from "./decouverte-de-pile.js";

/**
 * L'agent de découverte de pile (ADR 0076) : il lit le projet et propose son profil ; le code le
 * vérifie (`verifierPiles`) avant que rien ne soit écrit. Lecture seule, sans shell, sortie par
 * `submit_pile`, question par `report_blocker`. Le prompt est une constante du cœur : il voyage
 * avec l'application et le serveur MCP sans fichier à copier.
 */
export const ROLE_DECOUVREUR = "agent-studio/decouvreur-de-pile";

export const PROMPT_DECOUVREUR = `Tu découvres la pile d'un projet : comment lancer ses tests, où vivent ses fichiers, comment
lire ses rapports. Tu lis le projet avec tes outils de lecture ; tu n'écris rien, tu n'exécutes rien.
Tu proposes un profil par l'outil \`submit_pile\` ; le code le vérifie ensuite en l'exécutant (des
tests témoins, les « canaris », lancés dans une copie du projet), et te le rend avec les motifs
s'il est refusé.

Tu reçois des indices trouvés par le code (fichiers, dépendances, BDD détecté, et parfois un modèle
de profil reconnu par ses règles). Pars d'eux, vérifie-les en lisant le projet, et écarte-t'en si
le projet dit autre chose.

## Le profil (YAML)

- \`id\` : un nom court pour cette pile.
- \`detect\` : ce qui la signale, des fichiers présents (\`- un-fichier\`) ou un fichier qui contient
  une sous-chaîne (\`- { fichier: un-manifeste, contient: '"une-dependance"' }\`).
- \`outils\` (facultatif) : dossiers du projet où sont installés ses programmes (un environnement
  local), mis en tête du PATH. Préfère-les à un lanceur intermédiaire. Pour la pile d'un composant,
  ils sont relatifs à sa racine ; un dossier d'outils partagé à la racine du projet se désigne en
  remontant (\`../../…\`), sans jamais sortir du projet.
- \`tests\` : \`command\` (programme puis arguments, une liste, jamais une ligne de shell) et
  \`report\`, l'un des lecteurs de tests qui te sont donnés. La commande écrit son rapport dans \`{rapport}\`
  (un fichier), ou dans \`{rapports}\` (un dossier) si elle en produit plusieurs. \`coverage:
  cobertura-xml\` si elle écrit aussi une couverture Cobertura dans le dossier \`{couverture}\`.
- \`lint\` (facultatif) : \`command\` et \`report\`, un lecteur de lint donné, lu sur la sortie
  standard ; \`{fichiers}\` reçoit les fichiers à juger. Ne le déclare que si l'outil produit ce format.
- \`format\` (facultatif) : \`command\` qui vérifie la mise en forme sans rien modifier.
- \`mutation\` (facultatif) : \`command\` et \`report\`, un lecteur de mutation donné, écrit dans
  \`{rapport}\` ou sous \`{dossier}\`.
- \`layout\` : \`unitTests\`, \`acceptanceTests\`, \`sources\`, des motifs de chemins (\`tests/**\`). Au
  moins un emplacement de tests.
- \`buildErrors\` (langage compilé) : \`pattern\`, une expression appliquée ligne à ligne avec les
  groupes nommés \`file\` et \`message\` ; \`missingSymbol\`, les sous-chaînes d'un symbole absent.
- \`bdd\` : \`false\`, ou une liste de couples \`{ lanceur, features, etapes }\` (les lanceurs connus te
  sont donnés). Si le projet
  montre des \`.feature\` ou un lanceur BDD, déclare-le, ou \`bdd: false\` s'il n'en fait pas.
- \`infrastructureModules\` : ce que le domaine ne doit pas importer (bibliothèques d'accès aux
  données, frameworks web).
- \`canaries\` : quatre tests témoins, un par genre — \`passed\` (un test qui passe), \`assertion\`
  (une assertion qui échoue), \`missing_symbol\` (un appel à un symbole inexistant), \`syntax\` (du code
  qui ne compile pas). Chacun a \`kind\`, \`file\` (un chemin de test que la commande trouve, qui
  contient \`{marque}\`) et \`content\` (le test, qui contient \`{marque}\`, sauf \`syntax\`). Écris-les
  dans le langage et le style de tests du projet ; l'assertion compare l'obtenu à l'attendu.

Les programmes nommés doivent être dans la liste des programmes autorisés qui t'est donnée. Un autre
programme sera demandé à l'utilisateur ; s'il refuse, ta proposition est rejetée.

## Plusieurs piles

Un dépôt qui mélange plusieurs sous-projets (dossiers avec leur propre manifeste et leurs tests) a
une pile par sous-projet : donne à chacune sa \`racine\` (relative au projet) et un \`nom\`, ses chemins
étant relatifs à cette racine. Un projet simple a une seule pile, de racine \`.\`.

## Rendre ton travail

Appelle \`submit_pile\` avec les piles et une justification : ce qui, dans le projet, fonde tes choix.
S'il te manque une information que le projet ne donne pas (quelle commande parmi plusieurs, par
exemple), appelle \`report_blocker\` avec ta question et les réponses possibles. N'invente rien.`;

export function createDecouverteParAgent(o: {
  /** Le lanceur d'agents des services, résolu au moment de la découverte. */
  agents(): TaskAgentRunner;
  programmes: ParseOptions;
  lirePile: Decouverte["lirePile"];
  /** Modèle de la classe `standard` (ADR 0048), s'il y en a un. */
  modele?(): Promise<string | undefined>;
  logger?: Logger;
}): Decouverte {
  return {
    lirePile: o.lirePile,
    async decouvrir(d: DemandeDecouverte): Promise<ReponseDecouverte> {
      // Un essai raté doit se comprendre après coup : sans ces lignes, le journal ne disait que « session ouverte ».
      if (d.precedent) o.logger?.info("pile refusée par le code", { motifs: d.precedent.motifs.join("\n") });
      const permis = o.programmes.allowedPrograms.length ? `Programmes autorisés : ${o.programmes.allowedPrograms.join(", ")}.` : "Aucun programme n'est autorisé.";
      const prompt = [
        "# Indices trouvés par le code",
        d.indices,
        "# Programmes",
        [permis, o.programmes.origine].filter(Boolean).join(" "),
        "# Lecteurs de rapport",
        Object.entries(LECTEURS_PAR_SECTION).map(([section, lecteurs]) => `- ${section} : ${lecteurs.join(", ")}`).join("\n"),
        "# BDD",
        `Lanceurs BDD connus : ${LANCEURS_BDD.join(", ")}.`,
        ...(d.precedent
          ? [
              "# Ta proposition précédente a été refusée",
              d.precedent.piles.map((p) => `Racine \`${p.racine}\` :\n\n\`\`\`yaml\n${p.yaml.trimEnd()}\n\`\`\``).join("\n\n"),
              "Motifs du refus, à corriger :",
              d.precedent.motifs.map((m) => `- ${m}`).join("\n"),
            ]
          : []),
      ].join("\n\n");
      try {
        const modele = await o.modele?.();
        const r = await o.agents().run({ role: ROLE_DECOUVREUR, systemPrompt: PROMPT_DECOUVREUR, writable: [], output: "submit_pile", blocker: true, ...(modele ? { model: modele } : {}) }, prompt);
        if (r.blocker) {
          o.logger?.info("question de l'agent de découverte", { question: r.blocker.question });
          return { question: r.blocker.question, choix: r.blocker.choices };
        }
        o.logger?.info("pile proposée par l'agent", { racines: r.output.piles.map((p) => p.racine).join(", "), justification: r.output.justification });
        return { piles: r.output.piles.map((p) => ({ racine: p.racine, yaml: p.yaml, ...(p.nom ? { nom: p.nom } : {}) })), justification: r.output.justification };
      } catch (e) {
        return { erreur: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
