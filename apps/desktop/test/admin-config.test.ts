import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultAdminConfigPath, loadAdminConfig } from "../src/main/admin-config.js";

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
