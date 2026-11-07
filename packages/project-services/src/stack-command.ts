import type { ConfirmAnswer } from "@agent-studio/core";
import { proposeProfile, type Constat, type IndicesDuProjet, type StackProfile } from "@agent-studio/stack-adapters";

/**
 * Commande `/stack` (SPEC §8.6). Elle donne accès, depuis la conversation, à ce qui n'existait
 * que sous forme de fonctions : l'état de la stack, le diagnostic d'un profil, et sa proposition.
 *
 * Une règle gouverne tout le fichier : **rien n'est écrit sans que l'utilisateur ait vu et
 * approuvé**. Un profil est une liste de commandes exécutées sur la machine ; l'écrire revient à
 * élargir des permissions (§8.5), et cela ne se fait pas sur la foi d'un résumé.
 */

/** Profil déclaré par le projet : lu et valide, lu et refusé, ou absent. */
export type ProfilDeclare = { profile: StackProfile } | { error: string } | null;

export interface StackCommandDeps {
  /** Emplacement du profil dans le dépôt, cité tel quel à l'utilisateur. */
  chemin: string;
  /** Ce que le projet porte : fichiers repères et dépendances déclarées. */
  indices(): Promise<IndicesDuProjet>;
  profilDeclare(): Promise<ProfilDeclare>;
  /** Stack effectivement retenue pour ce projet, et si elle vient d'une déclaration. */
  stackActive(): { id: string; declaree: boolean } | null;
  ecrireProfil(yaml: string): Promise<void>;
  diagnostiquer(profile: StackProfile): Promise<Constat[]>;
  /**
   * Éprouve le profil **en l'exécutant** : les canaris tournent dans une copie isolée du projet
   * (§8.6). Absente, le diagnostic reste une relecture et le rapport le dit — c'est la
   * différence entre un profil déclaré sain et un profil éprouvé.
   */
  canaris?(profile: StackProfile): Promise<Constat[]>;
  confirmer(req: { title: string; detail: string }): Promise<ConfirmAnswer>;
  post(markdown: string): void;
}

const SOUS_COMMANDES = ["init", "doctor"] as const;

export function createStackCommand(deps: StackCommandDeps): (args: string) => Promise<void> {
  return async (args: string) => {
    const sous = args.trim().split(/\s+/)[0] ?? "";
    if (sous === "") return deps.post(await etat(deps));
    if (sous === "doctor") return deps.post(await doctor(deps));
    if (sous === "init") return init(deps);
    deps.post(
      `Sous-commande inconnue : \`${sous}\`. \`/stack\` sans argument donne l'état, ` +
        SOUS_COMMANDES.map((s) => `\`/stack ${s}\``).join(" et ") +
        " font le reste.",
    );
  };
}

async function etat(deps: StackCommandDeps): Promise<string> {
  const declare = await deps.profilDeclare();
  if (declare && "error" in declare)
    return (
      `**Le profil de stack du projet est refusé.** ${declare.error}\n\n` +
      `L'application se rabat sur la détection automatique. Corrigez \`${deps.chemin}\`, puis rouvrez le projet.`
    );

  const active = deps.stackActive();
  if (!active)
    return (
      `**Aucune stack reconnue pour ce projet.** Les portes qui dépendent des tests, du linter ou ` +
      `de la mutation ne sont pas disponibles, et elles le diront plutôt que d'inventer un résultat.\n\n` +
      `\`/stack init\` propose un profil à partir de ce que le projet porte.`
    );

  if (active.declaree)
    return (
      `Stack du projet : **${active.id}**, déclarée par \`${deps.chemin}\`.\n\n` +
      `\`/stack doctor\` vérifie ce que ce profil vaut.`
    );

  return (
    `Stack du projet : **${active.id}**, **détectée** — aucun profil n'est déclaré.\n\n` +
    `La détection ne regarde que la présence de quelques fichiers ; elle se trompe dès qu'un projet ` +
    `sort de l'ordinaire. \`/stack init\` propose un profil à écrire dans \`${deps.chemin}\`, que le ` +
    `projet versionne avec son code.`
  );
}

const ORDRE: Record<Constat["gravite"], number> = { probleme: 0, avertissement: 1, ok: 2 };
const PUCE: Record<Constat["gravite"], string> = { probleme: "❌", avertissement: "⚠️", ok: "✅" };

async function doctor(deps: StackCommandDeps): Promise<string> {
  const declare = await deps.profilDeclare();
  if (!declare)
    return (
      `**Aucun profil déclaré** : il n'y a rien à diagnostiquer. \`/stack init\` en propose un, ` +
      `et \`/stack\` dit quelle stack l'application emploie en attendant.`
    );
  if ("error" in declare)
    return `**Le profil de stack est refusé**, il n'a donc pas été diagnostiqué : ${declare.error}\n\nCorrigez \`${deps.chemin}\` d'abord.`;

  const releve = await deps.diagnostiquer(declare.profile);

  // Les canaris exécutent la suite de tests une fois par canari : plusieurs minutes, pendant
  // lesquelles l'application semblerait figée si on ne disait rien.
  let mesures: Constat[] | null = null;
  if (deps.canaris) {
    deps.post(
      `Diagnostic de \`${declare.profile.id}\` en cours. Les canaris s'exécutent dans une **copie isolée** du projet ` +
        `— votre travail en cours n'est pas touché —, et la suite de tests y est lancée une fois par canari : ` +
        `cela peut durer plusieurs minutes.`,
    );
    try {
      mesures = await deps.canaris(declare.profile);
    } catch (err) {
      // Une mesure qui échoue n'est pas une mesure favorable : elle devient un problème, sans
      // quoi le rapport conclurait « aucun problème » sur la foi d'une vérification avortée.
      mesures = [
        {
          gravite: "probleme",
          message: `Les canaris n'ont pas pu être exécutés : ${err instanceof Error ? err.message : String(err)}. La classification des échecs reste donc inconnue.`,
        },
      ];
    }
  }

  const constats = [...releve, ...(mesures ?? [])].sort((a, b) => ORDRE[a.gravite] - ORDRE[b.gravite]);
  const problemes = constats.filter((c) => c.gravite === "probleme").length;

  const lignes = [`# Diagnostic du profil \`${declare.profile.id}\``, ""];
  lignes.push(
    problemes === 0
      ? "**Aucun problème.** Les commandes déclarées sont lançables."
      : `**${problemes} problème${problemes > 1 ? "s" : ""}.** Tant qu'ils durent, les portes concernées échoueront.`,
    "",
  );
  for (const c of constats) lignes.push(`- ${PUCE[c.gravite]} ${c.message}`);

  // Une porte qui ne mesure rien ne doit rien attester : sans canaris, ce rapport ne doit pas
  // laisser croire que le profil a été éprouvé, alors qu'il n'a été que relu.
  if (mesures === null)
    lignes.push(
      "",
      "---",
      "",
      "**Ce que ce diagnostic n'a pas vérifié.** Rien n'a été exécuté : les commandes n'ont pas été " +
        "lancées, et les **canaris** — ces tests dont la bonne réponse est connue d'avance, qui seuls " +
        "prouvent qu'une erreur de syntaxe ne passe pas pour une assertion — n'ont pas tourné. Un " +
        "profil déclaré sain ici peut encore classer un échec de travers.",
    );
  return lignes.join("\n");
}

async function init(deps: StackCommandDeps): Promise<void> {
  const declare = await deps.profilDeclare();
  if (declare && "profile" in declare)
    return deps.post(
      `Un profil de stack **existe déjà** dans \`${deps.chemin}\` (\`${declare.profile.id}\`). ` +
        `\`/stack init\` ne l'écrase pas. Pour savoir ce qu'il vaut : \`/stack doctor\` ; pour le changer, éditez-le.`,
    );

  const indices = await deps.indices();
  const yaml = proposeProfile(indices);
  if (yaml === null)
    return deps.post(
      `**Rien de reconnu dans ce projet**, et je préfère ne rien proposer plutôt que de deviner. ` +
        `Les marques cherchées sont \`pyproject.toml\`, \`setup.cfg\`, et la dépendance \`vitest\`.\n\n` +
        `Vous pouvez écrire \`${deps.chemin}\` à la main : \`profiles/typescript.yaml\` en est un exemple commenté, à ce format.`,
    );

  const programmes = programmesDe(yaml);
  deps.post(
    `Profil proposé pour ce projet, d'après ${indices.fichiers.length} fichier(s) repère(s) :\n\n` +
      "```yaml\n" +
      yaml +
      "```\n\n" +
      `Il sera écrit dans \`${deps.chemin}\` après votre accord.`,
  );

  const reponse = await deps.confirmer({
    title: `Écrire le profil de stack dans ${deps.chemin} ?`,
    // Les programmes sont nommés dans la demande : c'est eux qu'on autorise à s'exécuter, et
    // c'est la seule information que l'utilisateur ne peut pas deviner d'un identifiant de stack.
    detail:
      `Ce profil autorise l'application à lancer : ${programmes.map((p) => `\`${p}\``).join(", ")}. ` +
      `Ces programmes s'exécuteront dans le projet lors des portes de test, de lint et de mutation.`,
  });

  if (reponse === "deny")
    return deps.post(`**Rien n'a été écrit.** Le profil proposé reste ci-dessus si vous voulez le reprendre à la main.`);

  await deps.ecrireProfil(yaml);
  deps.post(
    `Profil écrit dans \`${deps.chemin}\`. Il est versionné avec le projet, donc partagé par toute l'équipe.\n\n` +
      `Rouvrez le projet pour qu'il prenne effet, puis \`/stack doctor\` pour voir ce qu'il vaut.`,
  );
}

/** Premier mot de chaque `command:` du YAML proposé : le programme réellement lancé. */
function programmesDe(yaml: string): string[] {
  const trouves = [...yaml.matchAll(/^\s*command:\s*\[\s*([A-Za-z0-9_.-]+)/gm)].map((m) => m[1]!);
  return [...new Set(trouves)];
}
