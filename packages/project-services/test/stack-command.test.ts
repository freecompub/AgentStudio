/**
 * La commande `/stack` (SPEC §8.6). Elle rend visible ce qui n'existait jusqu'ici que sous forme
 * de fonctions : quelle stack le projet emploie, ce qu'un profil déclaré vaut, et ce qu'`init`
 * écrirait.
 *
 * Le fil conducteur des tests : **rien n'est écrit sans que l'utilisateur ait vu et approuvé**.
 * Un profil est une liste de commandes à exécuter sur la machine ; l'écrire équivaut à élargir
 * des permissions (§8.5).
 */
import { describe, expect, it, vi } from "vitest";
import type { StackProfile } from "@agent-studio/stack-adapters";
import { parseStackProfile } from "@agent-studio/stack-adapters";
import { createStackCommand, type StackCommandDeps } from "../src/stack-command.js";

/** Extrait de la liste par défaut de l'administrateur : les modèles proposés doivent s'y tenir. */
const AUTORISES = ["pytest", "vitest", "eslint", "ruff", "stryker"];

const profil = (yaml: string): StackProfile => {
  const r = parseStackProfile(yaml, { allowedPrograms: AUTORISES });
  if ("error" in r) throw new Error(r.error);
  return r.profile;
};

const PROFIL_VALIDE = profil(`
id: python
detect: [pyproject.toml]
tests:
  command: [pytest, "--junit-xml={rapport}"]
  report: junit-xml
layout:
  acceptanceTests: []
  unitTests: ["tests/**"]
  sources: ["src/**"]
infrastructureModules: []
`);

function harnais(over: Partial<StackCommandDeps> = {}) {
  const postes: string[] = [];
  const ecrits: string[] = [];
  const deps: StackCommandDeps = {
    chemin: ".agent-studio/stack.yaml",
    indices: async () => ({ fichiers: ["pyproject.toml"], dependances: [] }),
    profilDeclare: async () => null,
    stackActive: () => null,
    ecrireProfil: async (yaml) => void ecrits.push(yaml),
    diagnostiquer: async () => [{ gravite: "ok", message: "tout va bien" }],
    confirmer: async () => "allow-once",
    post: (md) => void postes.push(md),
    ...over,
  };
  return { deps, postes, ecrits, lancer: createStackCommand(deps) };
}

describe("/stack — état de la stack du projet", () => {
  it("dit quelle stack est employée et d'où elle vient, quand elle est déclarée", async () => {
    const h = harnais({ stackActive: () => ({ id: "python", declaree: true }), profilDeclare: async () => ({ profile: PROFIL_VALIDE }) });
    await h.lancer("");
    expect(h.postes[0]).toMatch(/python/);
    expect(h.postes[0]).toMatch(/\.agent-studio\/stack\.yaml/);
  });

  it("distingue une stack détectée d'une stack déclarée : l'une est un choix, l'autre une devinette", async () => {
    const h = harnais({ stackActive: () => ({ id: "typescript", declaree: false }) });
    await h.lancer("");
    expect(h.postes[0]).toMatch(/détect/i);
    expect(h.postes[0]).toMatch(/\/stack init/);
  });

  it("aucune stack reconnue : le dit, et propose la marche à suivre", async () => {
    const h = harnais({ stackActive: () => null });
    await h.lancer("");
    expect(h.postes[0]).toMatch(/aucune stack/i);
    expect(h.postes[0]).toMatch(/\/stack init/);
  });

  it("un profil déclaré mais refusé est signalé à l'état, avec sa raison", async () => {
    const h = harnais({ profilDeclare: async () => ({ error: "tests.report — lecteur inconnu (reçu : « tap »)" }) });
    await h.lancer("");
    expect(h.postes[0]).toMatch(/refusé/i);
    expect(h.postes[0]).toMatch(/tap/);
  });

  it("une sous-commande inconnue est nommée, et les sous-commandes valides listées", async () => {
    const h = harnais();
    await h.lancer("repare");
    expect(h.postes[0]).toMatch(/repare/);
    expect(h.postes[0]).toMatch(/init/);
    expect(h.postes[0]).toMatch(/doctor/);
  });
});

describe("/stack doctor — ce que vaut le profil déclaré", () => {
  it("sans profil déclaré, il n'y a rien à diagnostiquer et doctor le dit", async () => {
    const h = harnais({ profilDeclare: async () => null });
    await h.lancer("doctor");
    expect(h.postes[0]).toMatch(/aucun profil/i);
    expect(h.deps.diagnostiquer).toBeDefined();
  });

  it("rend les constats groupés par gravité, les problèmes en premier", async () => {
    const h = harnais({
      profilDeclare: async () => ({ profile: PROFIL_VALIDE }),
      diagnostiquer: async () => [
        { gravite: "ok", message: "`pytest` est lançable." },
        { gravite: "probleme", message: "`ruff` est introuvable." },
        { gravite: "avertissement", message: "Aucun outil de mutation déclaré." },
      ],
    });
    await h.lancer("doctor");
    const md = h.postes[0]!;
    expect(md.indexOf("ruff")).toBeLessThan(md.indexOf("mutation"));
    expect(md.indexOf("mutation")).toBeLessThan(md.indexOf("lançable"));
  });

  it("conclut sur un verdict : un problème empêche de s'en remettre au profil", async () => {
    const avec = harnais({
      profilDeclare: async () => ({ profile: PROFIL_VALIDE }),
      diagnostiquer: async () => [{ gravite: "probleme", message: "`ruff` est introuvable." }],
    });
    await avec.lancer("doctor");
    expect(avec.postes[0]).toMatch(/\*\*1 problème\*\*|1 problème/);

    const sans = harnais({ profilDeclare: async () => ({ profile: PROFIL_VALIDE }) });
    await sans.lancer("doctor");
    expect(sans.postes[0]).toMatch(/aucun problème/i);
  });

  it("sans moyen de lancer les canaris, dit ce qu'il n'a PAS vérifié", async () => {
    const h = harnais({ profilDeclare: async () => ({ profile: PROFIL_VALIDE }) });
    await h.lancer("doctor");
    // Une porte qui ne mesure rien ne doit rien attester : le rapport ne doit pas laisser
    // croire que le profil a été éprouvé par exécution.
    expect(h.postes.at(-1)).toMatch(/canari/i);
    expect(h.postes.at(-1)).toMatch(/pas .*(exécut|lancé)|sans .*exécution/i);
  });
});

describe("/stack doctor — vérification par exécution", () => {
  const avecCanaris = (canaris: StackCommandDeps["canaris"]) =>
    harnais({ profilDeclare: async () => ({ profile: PROFIL_VALIDE }), ...(canaris ? { canaris } : {}) });

  it("prévient avant de lancer : le diagnostic exécute la suite de tests plusieurs fois", async () => {
    const h = avecCanaris(async () => [{ gravite: "ok", message: "Canari `passed` : un test trivial passe." }]);
    await h.lancer("doctor");
    // Sans avertissement, l'utilisateur croit l'application figée pendant plusieurs minutes.
    expect(h.postes[0]).toMatch(/copie isolée|worktree/i);
    expect(h.postes[0]).toMatch(/plusieurs (fois|minutes)|peut durer/i);
  });

  it("verse les constats des canaris dans le rapport, avec ceux de la relecture", async () => {
    const h = avecCanaris(async () => [{ gravite: "probleme", message: "Canari `syntax` : une erreur de syntaxe est classée `assertion`." }]);
    await h.lancer("doctor");
    const md = h.postes.at(-1)!;
    expect(md).toMatch(/syntax/);
    expect(md).toMatch(/tout va bien/); // le constat statique reste présent
    expect(md).toMatch(/1 problème/);
  });

  it("une fois les canaris passés, le rapport ne dit plus qu'il n'a rien exécuté", async () => {
    const h = avecCanaris(async () => [{ gravite: "ok", message: "Canari `syntax` : classée `other_error`." }]);
    await h.lancer("doctor");
    expect(h.postes.at(-1)).not.toMatch(/n'a pas vérifié|sans .*exécution/i);
  });

  it("des canaris qui échouent à s'exécuter sont un problème, pas un silence", async () => {
    const h = avecCanaris(async () => {
      throw new Error("git worktree indisponible");
    });
    await h.lancer("doctor");
    const md = h.postes.at(-1)!;
    expect(md).toMatch(/git worktree indisponible/);
    expect(md).toMatch(/probl/i);
    // Et surtout : le rapport ne doit pas conclure « aucun problème » après un échec de mesure.
    expect(md).not.toMatch(/Aucun problème/);
  });

  it("un profil refusé ne se diagnostique pas : on corrige d'abord le YAML", async () => {
    const diagnostiquer = vi.fn(async () => []);
    const h = harnais({ profilDeclare: async () => ({ error: "id — attendu une chaîne" }), diagnostiquer });
    await h.lancer("doctor");
    expect(diagnostiquer).not.toHaveBeenCalled();
    expect(h.postes[0]).toMatch(/refusé/i);
  });
});

describe("/stack init — proposer, faire approuver, puis écrire", () => {
  it("montre le profil proposé AVANT d'écrire quoi que ce soit", async () => {
    const h = harnais();
    await h.lancer("init");
    // Le YAML complet est posté : l'utilisateur approuve ce qu'il a lu, pas un résumé.
    expect(h.postes[0]).toMatch(/```yaml[\s\S]*pytest[\s\S]*```/);
  });

  it("n'écrit rien sans confirmation, et le dit", async () => {
    const h = harnais({ confirmer: async () => "deny" });
    await h.lancer("init");
    expect(h.ecrits).toEqual([]);
    expect(h.postes.at(-1)).toMatch(/pas écrit|annulé|rien n'a été/i);
  });

  it("la confirmation nomme les programmes que le profil lancera", async () => {
    const demandes: { title: string; detail: string }[] = [];
    const h = harnais({
      confirmer: async (req) => {
        demandes.push(req);
        return "allow-once";
      },
    });
    await h.lancer("init");
    expect(demandes).toHaveLength(1);
    expect(`${demandes[0]!.title} ${demandes[0]!.detail}`).toMatch(/pytest/);
  });

  it("après confirmation, écrit le profil et dit où", async () => {
    const h = harnais();
    await h.lancer("init");
    expect(h.ecrits).toHaveLength(1);
    expect(h.ecrits[0]).toMatch(/id: python/);
    expect(h.postes.at(-1)).toMatch(/\.agent-studio\/stack\.yaml/);
  });

  it("ne propose rien plutôt que de deviner, quand le projet ne porte aucune marque reconnue", async () => {
    const h = harnais({ indices: async () => ({ fichiers: ["README.md"], dependances: [] }) });
    await h.lancer("init");
    expect(h.ecrits).toEqual([]);
    expect(h.postes[0]).toMatch(/reconnu|deviner|aucun/i);
  });

  it("refuse d'écraser un profil déjà déclaré sans le dire", async () => {
    const h = harnais({ profilDeclare: async () => ({ profile: PROFIL_VALIDE }) });
    await h.lancer("init");
    expect(h.ecrits).toEqual([]);
    expect(h.postes[0]).toMatch(/existe déjà/i);
    expect(h.postes[0]).toMatch(/doctor/);
  });

  it("le profil proposé est toujours relisible : ce qu'on écrit doit pouvoir être rechargé", async () => {
    const h = harnais();
    await h.lancer("init");
    expect("error" in parseStackProfile(h.ecrits[0]!, { allowedPrograms: AUTORISES })).toBe(false);
  });
});

/**
 * Composants (ADR 0074, brique 2) : `/stack` les montre, `/stack doctor` diagnostique chacun dans sa
 * racine, et `/stack init` cherche les sous-projets (jusqu'à 4 niveaux) pour proposer la section
 * `composants` quand il y en a plusieurs, ou un seul hors de la racine.
 */
describe("/stack et les composants (ADR 0074)", () => {
  const PY = PROFIL_VALIDE;
  const TS = profil(`
id: typescript
detect: [package.json]
tests:
  command: [vitest, run]
  report: vitest-json
layout:
  unitTests: ["tests/**"]
`);
  const declares = async () => ({ composants: [{ nom: "api", racine: "services/api", profile: PY }, { nom: "web", racine: "web", profile: TS }] });

  it("/stack : les composants déclarés, avec leur racine et leur pile", async () => {
    const h = harnais({ profilDeclare: declares, stackActive: () => ({ id: "python", declaree: true }) });
    await h.lancer("");
    expect(h.postes[0]).toMatch(/2 composants/);
    expect(h.postes[0]).toMatch(/api.*python.*services\/api/);
    expect(h.postes[0]).toMatch(/web.*typescript.*web/);
  });

  it("/stack doctor : un diagnostic par composant, chacun relu dans sa racine", async () => {
    const racines: string[] = [];
    const h = harnais({ profilDeclare: declares, diagnostiquer: async (p, racine) => (racines.push(racine ?? "."), [{ gravite: "ok", message: `relu ${p.id}` }]) });
    await h.lancer("doctor");
    expect(racines).toEqual(["services/api", "web"]);
    const rapport = h.postes.at(-1)!;
    expect(rapport).toMatch(/## Composant `api` \(`services\/api`\) — profil `python`/);
    expect(rapport).toMatch(/## Composant `web` \(`web`\) — profil `typescript`/);
    expect(rapport).toMatch(/relu python[\s\S]*relu typescript/);
  });

  it("/stack init : plusieurs sous-projets reconnus, la section composants est proposée, confirmée, puis écrite", async () => {
    const ecrits: string[] = [];
    let demande = "";
    const h = harnais({
      sousProjets: async () => [
        { racine: "services/api", indices: { fichiers: ["pyproject.toml"], dependances: [] } },
        { racine: "web", indices: { fichiers: ["package.json"], dependances: ["vitest"] } },
        { racine: "docs", indices: { fichiers: ["README.md"], dependances: [] } },
      ],
      ecrireComposants: async (yaml) => void ecrits.push(yaml),
      confirmer: async (r) => ((demande = `${r.title} ${r.detail}`), "allow-once"),
    });
    await h.lancer("init");
    expect(h.postes[0]).toMatch(/composants/);
    expect(h.postes[0]).toMatch(/nom: api[\s\S]*racine: services\/api[\s\S]*nom: web[\s\S]*racine: web/);
    expect(demande).toMatch(/pytest/);
    expect(demande).toMatch(/vitest/);
    expect(ecrits).toHaveLength(1);
    expect(h.ecrits).toEqual([]);
    const { lireFichierProjet } = await import("@agent-studio/stack-adapters");
    const relu = lireFichierProjet(`composants:\n${ecrits[0]!.split("\n").map((l) => (l ? `  ${l}` : l)).join("\n")}`);
    if ("error" in relu) throw new Error(relu.error);
    expect(relu.composants?.map((c) => [c.nom, c.racine])).toEqual([["api", "services/api"], ["web", "web"]]);
    for (const c of relu.composants!) expect("error" in parseStackProfile(c.pile, { allowedPrograms: AUTORISES })).toBe(false);
  });

  it("/stack init : un seul sous-projet, à la racine, la section pile comme avant ; hors de la racine, un composant", async () => {
    const racine = harnais({ sousProjets: async () => [{ racine: ".", indices: { fichiers: ["pyproject.toml"], dependances: [] } }] });
    await racine.lancer("init");
    expect(racine.ecrits).toHaveLength(1);
    const ecrits: string[] = [];
    const sous = harnais({ sousProjets: async () => [{ racine: "api", indices: { fichiers: ["pyproject.toml"], dependances: [] } }], ecrireComposants: async (y) => void ecrits.push(y) });
    await sous.lancer("init");
    expect(ecrits[0]).toMatch(/nom: api[\s\S]*racine: api/);
  });

  it("/stack init : des composants déjà déclarés ne sont pas écrasés", async () => {
    const h = harnais({ profilDeclare: declares });
    await h.lancer("init");
    expect(h.postes[0]).toMatch(/composants.*existent déjà/is);
    expect(h.ecrits).toEqual([]);
  });
});
