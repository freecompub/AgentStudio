import type { ConfirmAnswer } from "@agent-studio/core";
import { ESSAIS_DE_DECOUVERTE, indicesPourLAgent, verifierPiles, type Decouverte, type PileProposee, type PileVerifiee } from "./decouverte-de-pile.js";
import { blocBdd, completerBdd, detecterBdd, LIBELLE_PARTIE, partiesManquantes, partiesTrouvees, proposeProfile, type Constat, type DetectionBdd, type IndicesDuProjet, type PartieBdd, type StackProfile } from "@agent-studio/stack-adapters";

/**
 * Commande `/stack` (SPEC §8.6). Elle donne accès, depuis la conversation, à ce qui n'existait
 * que sous forme de fonctions : l'état de la stack, le diagnostic d'un profil, et sa proposition.
 *
 * Une règle gouverne tout le fichier : **rien n'est écrit sans que l'utilisateur ait vu et
 * approuvé**. Un profil est une liste de commandes exécutées sur la machine ; l'écrire revient à
 * élargir des permissions (§8.5), et cela ne se fait pas sur la foi d'un résumé.
 */

/** Profil déclaré par le projet : lu et valide, lu et refusé, absent, ou ses composants (ADR 0074). */
export type ProfilDeclare =
  | { profile: StackProfile }
  | { composants: { nom: string; racine: string; profile: StackProfile }[] }
  | { error: string }
  | null;

/** Un dossier du projet et ce qu'il porte, pour reconnaître un sous-projet (ADR 0074). */
export interface SousProjet {
  /** Relative à la racine du projet ; `.` pour la racine elle-même. */
  racine: string;
  indices: IndicesDuProjet;
}

export interface StackCommandDeps {
  /** Emplacement du profil dans le dépôt, cité tel quel à l'utilisateur. */
  chemin: string;
  /** Ce que le projet porte : fichiers repères et dépendances déclarées. */
  indices(): Promise<IndicesDuProjet>;
  profilDeclare(): Promise<ProfilDeclare>;
  /** Stack effectivement retenue pour ce projet, et si elle vient d'une déclaration. */
  stackActive(): { id: string; declaree: boolean } | null;
  ecrireProfil(yaml: string): Promise<void>;
  /**
   * Dossiers du projet jusqu'à 4 niveaux, avec ce qu'ils portent (ADR 0074). Absente : seule la
   * racine est regardée (`indices`), comme avant les composants.
   */
  sousProjets?(): Promise<SousProjet[]>;
  /** Écrit la section `composants` de `projet.yaml` (liste YAML de `nom`, `racine`, `pile`). */
  ecrireComposants?(yaml: string): Promise<void>;
  /** `racine` : celle du composant diagnostiqué, relative à la racine du projet ; absente, la racine. */
  diagnostiquer(profile: StackProfile, racine?: string): Promise<Constat[]>;
  /**
   * Éprouve le profil **en l'exécutant** : les canaris tournent dans une copie isolée du projet
   * (§8.6). Absente, le diagnostic reste une relecture et le rapport le dit — c'est la
   * différence entre un profil déclaré sain et un profil éprouvé.
   */
  canaris?(profile: StackProfile, racine?: string): Promise<Constat[]>;
  confirmer(req: { title: string; detail: string }): Promise<ConfirmAnswer>;
  post(markdown: string): void;
  /**
   * La pile découverte par un agent, vérifiée par le code (ADR 0076). Absente, les règles du code
   * proposent, comme avant.
   */
  decouverte?: Decouverte;
}

const SOUS_COMMANDES = ["init", "doctor"] as const;

export function createStackCommand(deps: StackCommandDeps): (args: string) => Promise<void> {
  return async (args: string) => {
    const sous = args.trim().split(/\s+/)[0] ?? "";
    if (sous === "") return deps.post(await etat(deps));
    if (sous === "doctor") return deps.post(await doctor(deps));
    if (sous === "init") return init(deps, args.trim().split(/\s+/).slice(1));
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
  if (declare && "composants" in declare)
    return (
      `Projet à **${declare.composants.length} composants**, déclarés par \`${deps.chemin}\` :\n\n` +
      declare.composants.map((c) => `- **${c.nom}** : pile \`${c.profile.id}\`, racine \`${c.racine}\``).join("\n") +
      `\n\n\`/stack doctor\` vérifie chacun.`
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
  // Composants (ADR 0074) : un diagnostic par composant, chacun relu dans sa racine.
  if ("composants" in declare) {
    const n = declare.composants.length;
    const parties: string[] = [n > 1 ? `# Diagnostic des ${n} composants` : "# Diagnostic du composant", ""];
    for (const c of declare.composants) {
      const rapport = await diagnostic(deps, c.profile, c.racine);
      parties.push(rapport.replace(/^# Diagnostic du profil `[^`]+`/, `## Composant \`${c.nom}\` (\`${c.racine}\`) — profil \`${c.profile.id}\``), "");
    }
    return parties.join("\n").trimEnd();
  }
  return diagnostic(deps, declare.profile);
}

/** Diagnostic d'un profil : relecture, puis canaris s'ils peuvent tourner ; `racine` : celle de son composant. */
async function diagnostic(deps: StackCommandDeps, profile: StackProfile, racine?: string): Promise<string> {
  const declare = { profile };
  const releve = await deps.diagnostiquer(declare.profile, ...(racine !== undefined ? [racine] : []));

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
      mesures = await deps.canaris(declare.profile, ...(racine !== undefined ? [racine] : []));
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

/** Options de `/stack init` (08/11) : la moitié manquante du BDD, ou le choix de s'en passer. */
interface OptionsInit {
  donne: Partial<Record<PartieBdd, string>>;
  sansBdd: boolean;
}
const OPTION_DE: Record<string, PartieBdd> = { "--lanceur": "lanceur", "--features": "features", "--etapes": "etapes" };

function lireOptions(mots: readonly string[]): OptionsInit | { error: string } {
  const o: OptionsInit = { donne: {}, sansBdd: false };
  for (let i = 0; i < mots.length; i++) {
    const m = mots[i]!;
    if (m === "--sans-bdd") o.sansBdd = true;
    else if (OPTION_DE[m]) {
      const v = mots[++i];
      if (!v || v.startsWith("--")) return { error: `\`${m}\` attend une valeur : \`/stack init ${m} <${m === "--lanceur" ? "nom" : "dossier"}>\`.` };
      o.donne[OPTION_DE[m]!] = v;
    } else return { error: `Option inconnue : \`${m}\`. Options de \`/stack init\` : \`--lanceur <nom>\`, \`--features <dossier>\`, \`--etapes <dossier>\`, \`--sans-bdd\`.` };
  }
  return o;
}

/** Ce qui manque, et la commande qui le donne. */
function demandeBdd(d: DetectionBdd, manque: readonly PartieBdd[]): string {
  const option = (p: PartieBdd) => `\`/stack init --${p} <${p === "lanceur" ? "nom" : "dossier"}>\``;
  return `Trouvé : ${partiesTrouvees(d)}. Manque : ${manque.map((p) => LIBELLE_PARTIE[p]).join(", ")}.\n\nDonne ce qui manque : ${manque.map(option).join(", ")} (les options se combinent). S'il ne fait pas de BDD : \`/stack init --sans-bdd\`.`;
}

async function init(deps: StackCommandDeps, mots: readonly string[] = []): Promise<void> {
  const options = lireOptions(mots);
  if ("error" in options) return deps.post(options.error);
  const declare = await deps.profilDeclare();
  if (declare && "profile" in declare)
    return deps.post(
      `Un profil de stack **existe déjà** dans \`${deps.chemin}\` (\`${declare.profile.id}\`). ` +
        `\`/stack init\` ne l'écrase pas. Pour savoir ce qu'il vaut : \`/stack doctor\` ; pour le changer, éditez-le.`,
    );
  if (declare && "composants" in declare)
    return deps.post(
      `Des composants **existent déjà** dans \`${deps.chemin}\` (${declare.composants.map((c) => `\`${c.nom}\``).join(", ")}). ` +
        `\`/stack init\` ne les écrase pas. Pour savoir ce qu'ils valent : \`/stack doctor\` ; pour les changer, éditez-le.`,
    );

  if (deps.decouverte) return initParAgent(deps, deps.decouverte, options);

  // Sous-projets (ADR 0074) : plusieurs reconnus, ou un seul hors de la racine, deviennent des composants.
  if (deps.sousProjets && deps.ecrireComposants) {
    const reconnus = (await deps.sousProjets())
      .map((p) => ({ racine: p.racine, yaml: proposeProfile(p.indices), d: detecterBdd({ fichiers: p.indices.arborescence ?? p.indices.fichiers, manifestes: p.indices.manifestes ?? [] }) }))
      .filter((p): p is { racine: string; yaml: string; d: DetectionBdd } => p.yaml !== null);
    if (reconnus.length > 1 || (reconnus.length === 1 && reconnus[0]!.racine !== ".")) {
      // Un BDD à moitié dans un composant : rien n'est écrit, sinon skraft partirait dans le mauvais mode (08/11).
      const amoitie = reconnus.filter((r) => partiesManquantes(r.d).length);
      if (amoitie.length)
        return deps.post(
          `**Rien n'a été écrit.** ${amoitie.map((r) => `\`${r.racine}\` : BDD détecté à moitié. Trouvé : ${partiesTrouvees(r.d)}. Manque : ${partiesManquantes(r.d).map((p) => LIBELLE_PARTIE[p]).join(", ")}.`).join("\n\n")}\n\n` +
            `Pour un dépôt à composants, complétez la section \`bdd\` de la pile du composant dans \`${deps.chemin}\` (\`lanceur\`, \`features\`, \`etapes\`), ou \`bdd: false\` s'il ne fait pas de BDD.`,
        );
      return initComposants(deps, deps.ecrireComposants, reconnus.map((r) => ({ racine: r.racine, yaml: `${r.yaml}${blocBdd(r.d)}` })));
    }
  }

  const indices = await deps.indices();
  const profil = proposeProfile(indices);
  if (profil === null)
    return deps.post(
      `**Rien de reconnu dans ce projet**, et je préfère ne rien proposer plutôt que de deviner. ` +
        `Les marques cherchées sont \`pyproject.toml\`, \`setup.cfg\`, et la dépendance \`vitest\`.\n\n` +
        `Vous pouvez écrire \`${deps.chemin}\` à la main : \`profiles/typescript.yaml\` en est un exemple commenté, à ce format.`,
    );

  // Le BDD (ADR 0074 §2.5, 08/11) : complet, il est confirmé avec le profil ; à moitié, on demande ce
  // qui manque et rien n'est écrit ; `--sans-bdd` déclare le choix.
  let bloc = "bdd: false\n";
  if (!options.sansBdd) {
    const arborescence = indices.arborescence ?? indices.fichiers;
    const c = completerBdd(detecterBdd({ fichiers: arborescence, manifestes: indices.manifestes ?? [] }), options.donne, arborescence);
    if ("error" in c) return deps.post(`**Rien n'a été écrit.** ${c.error}`);
    const manque = partiesManquantes(c.detection);
    if (manque.length) return deps.post(`**BDD détecté à moitié**, rien n'est écrit : sans lui, skraft refuserait de démarrer, ou partirait sans BDD.\n\n${demandeBdd(c.detection, manque)}`);
    bloc = blocBdd(c.detection);
  }
  return proposerEtEcrire(deps, `${profil}${bloc}`, `Profil proposé pour ce projet, d'après ${indices.fichiers.length} fichier(s) repère(s) :`);
}

/** Montre le profil, le fait approuver en nommant ses programmes, puis l'écrit. */
async function proposerEtEcrire(deps: StackCommandDeps, yaml: string, entete: string): Promise<void> {
  const programmes = programmesDe(yaml);
  deps.post(`${entete}\n\n` + "```yaml\n" + yaml + (yaml.endsWith("\n") ? "" : "\n") + "```\n\n" + `Il sera écrit dans \`${deps.chemin}\` après votre accord.`);

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

/**
 * `/stack init` par l'agent de découverte (ADR 0076) : il propose, le code vérifie, trois essais au
 * plus ; seule une proposition qui a tout passé est montrée, confirmée et écrite.
 */
async function initParAgent(deps: StackCommandDeps, deco: Decouverte, options: OptionsInit): Promise<void> {
  const indices = await deps.indices();
  const arborescence = indices.arborescence ?? indices.fichiers;
  // Une moitié du BDD donnée en option : vérifiée par le code, puis donnée à l'agent comme un fait.
  let faits = indicesPourLAgent({ indices, sousProjets: deps.sousProjets ? await deps.sousProjets() : [], sansBdd: options.sansBdd });
  if (Object.keys(options.donne).length) {
    const c = completerBdd(detecterBdd({ fichiers: arborescence, manifestes: indices.manifestes ?? [] }), options.donne, arborescence);
    if ("error" in c) return deps.post(`**Rien n'a été écrit.** ${c.error}`);
    faits += `\n\n## BDD donné par l'utilisateur\n\n${partiesTrouvees(c.detection)}`;
  }
  let precedent: { piles: PileProposee[]; motifs: string[] } | undefined;
  for (let essai = 1; essai <= ESSAIS_DE_DECOUVERTE; essai++) {
    const r = await deco.decouvrir({ indices: faits, ...(precedent ? { precedent } : {}) });
    if ("erreur" in r) return deps.post(`**Rien n'a été écrit.** La découverte de la pile n'a pas abouti : ${r.erreur}`);
    if ("question" in r)
      return deps.post(
        `**Rien n'a été écrit.** L'agent de découverte a besoin d'une réponse : ${r.question}` +
          (r.choix.length ? `\n\nRéponses possibles : ${r.choix.map((c) => `« ${c} »`).join(", ")}.` : "") +
          `\n\nÉcris la pile dans \`${deps.chemin}\`, ou relance la découverte une fois la question tranchée dans le projet.`,
      );
    const v = await verifierPiles(r.piles, {
      lirePile: (y) => deco.lirePile(y),
      diagnostiquer: (p, racine) => deps.diagnostiquer(p, racine),
      ...(deps.canaris ? { canaris: (p: StackProfile, racine: string) => deps.canaris!(p, racine) } : {}),
      indices,
      sansBdd: options.sansBdd,
    });
    if (!v.motifs.length) return ecrireLesPiles(deps, v.verifiees, r.justification);
    precedent = { piles: r.piles, motifs: v.motifs };
  }
  deps.post(
    `**Rien n'a été écrit.** La pile proposée par l'agent a été refusée ${ESSAIS_DE_DECOUVERTE} fois. Derniers motifs :\n\n` +
      precedent!.motifs.map((m) => `- ${m}`).join("\n") +
      "\n\nDernière proposition :\n\n" +
      precedent!.piles.map((p) => `Racine \`${p.racine}\` :\n\n\`\`\`yaml\n${p.yaml.trimEnd()}\n\`\`\``).join("\n\n"),
  );
}

/** Une pile à la racine va dans la section `pile` ; sinon, des composants (ADR 0074). */
async function ecrireLesPiles(deps: StackCommandDeps, piles: readonly PileVerifiee[], justification: string): Promise<void> {
  const verifie = "Vérifiée par le code : programmes, schéma, diagnostic" + (deps.canaris ? " et canaris lancés dans une copie du projet" : "") + ".";
  if (piles.length === 1 && piles[0]!.racine === ".")
    return proposerEtEcrire(deps, piles[0]!.yaml, `Profil proposé par l'agent de découverte : ${justification}\n\n${verifie}`);
  if (!deps.ecrireComposants) return deps.post(`**Rien n'a été écrit.** La pile proposée a plusieurs composants, et ce projet ne sait pas en écrire.`);
  deps.post(`Composants proposés par l'agent de découverte : ${justification}\n\n${verifie}`);
  return initComposants(deps, deps.ecrireComposants, piles.map((p) => ({ racine: p.racine, yaml: p.yaml })));
}

/** Propose la section `composants`, la fait confirmer en nommant les programmes, puis l'écrit. */
async function initComposants(deps: StackCommandDeps, ecrire: (yaml: string) => Promise<void>, reconnus: { racine: string; yaml: string }[]): Promise<void> {
  const noms = new Set<string>();
  const nomDe = (racine: string) => {
    const base = racine === "." ? "principal" : racine.split("/").at(-1)!;
    let nom = base;
    for (let i = 2; noms.has(nom); i++) nom = `${base}-${i}`;
    noms.add(nom);
    return nom;
  };
  const yaml = reconnus
    .map((r) => [`- nom: ${nomDe(r.racine)}`, `  racine: ${r.racine}`, "  pile:", ...r.yaml.trimEnd().split("\n").map((l) => (l ? `    ${l}` : l))].join("\n"))
    .join("\n")
    .concat("\n");
  const programmes = [...new Set(reconnus.flatMap((r) => programmesDe(r.yaml)))];
  deps.post(
    `Ce projet mélange ${reconnus.length > 1 ? `${reconnus.length} sous-projets` : "un sous-projet hors de la racine"} : ` +
      `composants proposés (ADR 0074), chacun avec sa racine et sa pile :\n\n` +
      "```yaml\ncomposants:\n" +
      yaml.split("\n").map((l) => (l ? `  ${l}` : l)).join("\n") +
      "```\n\n" +
      `Ils seront écrits dans \`${deps.chemin}\` après votre accord.`,
  );
  const reponse = await deps.confirmer({
    title: `Écrire les composants dans ${deps.chemin} ?`,
    detail:
      `Ces composants autorisent l'application à lancer : ${programmes.map((p) => `\`${p}\``).join(", ")}. ` +
      `Ces programmes s'exécuteront dans la racine de leur composant lors des portes de test, de lint et de mutation.`,
  });
  if (reponse === "deny") return deps.post(`**Rien n'a été écrit.** Les composants proposés restent ci-dessus si vous voulez les reprendre à la main.`);
  await ecrire(yaml);
  deps.post(`Composants écrits dans \`${deps.chemin}\`. Rouvrez le projet pour qu'ils prennent effet, puis \`/stack doctor\` pour voir ce qu'ils valent.`);
}

/** Premier mot de chaque `command:` du YAML proposé : le programme réellement lancé. */
function programmesDe(yaml: string): string[] {
  const trouves = [...yaml.matchAll(/^\s*command:\s*\[\s*([A-Za-z0-9_.-]+)/gm)].map((m) => m[1]!);
  return [...new Set(trouves)];
}
