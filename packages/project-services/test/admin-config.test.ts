import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultAdminConfigPath, loadAdminConfig } from "../src/admin-config.js";
import { DEFAULT_ALLOWED_PROGRAMS_FOR_TESTS } from "../../stack-adapters/test/support/programmes.js";

describe("Configuration administrateur (D6, O5)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "agent-studio-admin-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("sans fichier : profil développeur, aucun éditeur approuvé, pas de mode développeur (choix provisoire)", async () => {
    const c = await loadAdminConfig(join(dir, "absent.json"));
    expect(c).toMatchObject({ source: "défaut", profile: { role: "developpeur", defaultMode: "advanced", permissionPolicy: "souple" }, trustedPublishers: [], developerMode: false, revocation: null });
  });

  it("programmes autorisés par défaut : lanceurs de tests, linters, outils de format et de mutation courants (O12)", async () => {
    const c = await loadAdminConfig(join(dir, "absent.json"));
    // Ce sont ceux qu'un profil de stack peut nommer sans que l'administrateur intervienne.
    expect(c.allowedPrograms).toEqual(expect.arrayContaining(["pytest", "eslint", "stryker", "prettier"]));
    // La copie de `stack-adapters` (ses tests ne dépendent pas de l'application) doit suivre.
    expect([...c.allowedPrograms].sort()).toEqual([...DEFAULT_ALLOWED_PROGRAMS_FOR_TESTS].sort());
    // Et jamais de quoi sortir du projet ou atteindre le réseau.
    for (const interdit of ["curl", "wget", "rm", "bash", "sh", "ssh", "node", "npm"])
      expect(c.allowedPrograms, interdit).not.toContain(interdit);
  });

  it("l'administrateur remplace la liste, il ne s'y ajoute pas", async () => {
    // Remplacer plutôt que compléter : un poste administré doit pouvoir restreindre, et non
    // seulement élargir ce que nous avons jugé raisonnable.
    const file = join(dir, "admin.json");
    await writeFile(file, JSON.stringify({ allowedPrograms: ["pytest"] }));
    const c = await loadAdminConfig(file);
    expect(c.allowedPrograms).toEqual(["pytest"]);
  });

  /**
   * D'où vient la liste des programmes, à citer dans un refus (09/11) : un `admin.json` posé ailleurs
   * que là où il est lu, ou une liste qui remplace celle par défaut, ne se voient pas autrement.
   */
  describe("origine de la liste des programmes", () => {
    it("sans fichier : la liste par défaut, le fichier attendu et la règle de remplacement", async () => {
      const chemin = join(dir, "absent.json");
      expect((await loadAdminConfig(chemin)).origineDesProgrammes).toBe(
        `Liste par défaut : aucun fichier d'administration à ${chemin}. Pour la changer, y écrire \`allowedPrograms\` (qui remplace la liste par défaut, sans s'y ajouter), ou désigner un autre fichier par la variable AGENT_STUDIO_ADMIN_CONFIG.`,
      );
    });

    it("fichier sans `allowedPrograms` : la liste par défaut, et le fichier lu", async () => {
      const file = join(dir, "admin.json");
      await writeFile(file, JSON.stringify({ profile: { role: "architecte" } }));
      expect((await loadAdminConfig(file)).origineDesProgrammes).toBe(
        `Liste par défaut : ${file} ne contient pas \`allowedPrograms\`. L'y ajouter remplace la liste par défaut, sans s'y ajouter.`,
      );
    });

    it("fichier avec `allowedPrograms` : cette liste remplace celle par défaut", async () => {
      const file = join(dir, "admin.json");
      await writeFile(file, JSON.stringify({ allowedPrograms: ["uv"] }));
      expect((await loadAdminConfig(file)).origineDesProgrammes).toBe(
        `Liste de \`allowedPrograms\` dans ${file} ; elle remplace la liste par défaut, qui ne s'applique donc pas.`,
      );
    });

    it("fichier refusé : aucun programme, et pourquoi", async () => {
      const file = join(dir, "admin.json");
      await writeFile(file, "{ pas du json");
      expect((await loadAdminConfig(file)).origineDesProgrammes).toMatch(new RegExp(`^${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} est refusé \\(.+\\) : aucun programme n'est autorisé\\.$`));
    });
  });

  it("accord de l'utilisateur sur un programme hors liste (ADR 0075) : permis par défaut, l'administrateur peut l'interdire", async () => {
    expect((await loadAdminConfig(join(dir, "absent.json"))).programConsent).toBe(true);
    const file = join(dir, "admin.json");
    await writeFile(file, JSON.stringify({ programConsent: false }));
    expect((await loadAdminConfig(file)).programConsent).toBe(false);
    await writeFile(file, JSON.stringify({ profile: { role: "po" } }));
    expect((await loadAdminConfig(file)).programConsent).toBe(true);
    // Fichier refusé : rien de plus que ce que l'administrateur a pu relire, donc aucun accord.
    await writeFile(file, "{ pas du json");
    expect((await loadAdminConfig(file)).programConsent).toBe(false);
  });

  it("une liste vide interdit tout profil de stack, et c'est un choix valide", async () => {
    const file = join(dir, "admin.json");
    await writeFile(file, JSON.stringify({ allowedPrograms: [] }));
    expect((await loadAdminConfig(file)).allowedPrograms).toEqual([]);
  });

  it("un programme déclaré avec un chemin est refusé : seul un nom de commande est accepté", async () => {
    // `/usr/bin/../../tmp/piege` ou `./script` échapperaient à la liste par le chemin.
    const file = join(dir, "admin.json");
    await writeFile(file, JSON.stringify({ allowedPrograms: ["/usr/local/bin/pytest"] }));
    const c = await loadAdminConfig(file);
    expect(c.error).toMatch(/allowedPrograms/);
    expect(c.allowedPrograms).toEqual([]); // configuration refusée : on n'autorise rien
  });

  it("profil attribué par l'administrateur, avec surcharges ; éditeurs approuvés ; révocation", async () => {
    const file = join(dir, "admin.json");
    await writeFile(
      file,
      JSON.stringify({
        profile: { role: "po", defaultMode: "simple" },
        trustedPublishers: [{ publisher: "tiers", keyId: "abc", publicKeyPem: "PEM", trustedUpdates: true }],
        developerMode: false,
        revocation: { file: "/etc/agent-studio/revocation.json", rootPublicKeyPem: "ROOT" },
      }),
    );
    const c = await loadAdminConfig(file);
    expect(c.source).toBe(file);
    expect(c.profile).toEqual({ role: "po", defaultMode: "simple", permissionPolicy: "prudente" });
    expect(c.trustedPublishers).toHaveLength(1);
    expect(c.revocation).toEqual({ file: "/etc/agent-studio/revocation.json", rootPublicKeyPem: "ROOT" });
  });

  it("fichier invalide : profil le plus restreint (testeur), avec l'erreur", async () => {
    const file = join(dir, "admin.json");
    await writeFile(file, JSON.stringify({ profile: { role: "pirate" } }));
    const c = await loadAdminConfig(file);
    expect(c.profile.role).toBe("testeur");
    expect(c.error).toMatch(/profile\.role/);
  });

  it("emplacement système par défaut selon la plateforme", () => {
    expect(defaultAdminConfigPath("linux", {})).toBe("/etc/agent-studio/admin.json");
    expect(defaultAdminConfigPath("darwin", {})).toBe("/Library/Application Support/agent-studio/admin.json");
    expect(defaultAdminConfigPath("win32", { ProgramData: "C:\\ProgramData" })).toBe("C:\\ProgramData\\agent-studio\\admin.json");
    expect(defaultAdminConfigPath("linux", { AGENT_STUDIO_ADMIN_CONFIG: "/opt/x.json" })).toBe("/opt/x.json");
  });
});
