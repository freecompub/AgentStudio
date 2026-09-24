import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionManifest } from "@agent-studio/extension-api";
import { parseVersion, validateManifest } from "@agent-studio/extension-manifest";
import {
  extractPackage,
  isRevoked,
  readPackage,
  verifyPackage,
  verifyRevocationList,
  type TrustedPublisher,
} from "@agent-studio/extension-packaging";
import { describePermission } from "./permissions-text.js";

export interface ConsentRequest {
  kind: "install" | "update";
  extensionId: string;
  version: string;
  publisher: string;
  signed: boolean;
  /** Ce que l'extension apporte, en langage clair (titres et descriptions des commandes, D5). */
  commands: string[];
  permissions: { permission: string; description: string }[];
  /** Permissions nouvelles par rapport à la version installée (mise à jour). */
  added: { permission: string; description: string }[];
  warnings: string[];
}

export interface InstalledExtension {
  id: string;
  version: string;
  publisher: string;
  signed: boolean;
  installedAt: string;
  /** Raison de la désactivation (révocation…), ou `null`. */
  disabled: string | null;
}

export type InstallResult =
  | { status: "installed"; id: string; version: string }
  | { status: "declined" }
  | { status: "rejected"; reason: string };

export interface ExtensionInstallerDeps {
  /** Dossier des extensions installées (profil utilisateur). */
  installDir: string;
  appApi: string;
  /** Éditeurs approuvés et leurs clés (fournis par l'administrateur). */
  trusted: () => TrustedPublisher[];
  /** Mode développeur : autorise les paquets non signés, avec avertissement permanent (§12). */
  devMode: () => boolean;
  /** Accord de l'utilisateur, après affichage des permissions en langage clair. */
  consent: (req: ConsentRequest) => Promise<boolean>;
  /** Liste de révocation signée (ou `null` si indisponible). */
  revocation: () => Promise<unknown>;
  rootPublicKeyPem: string;
  clock: { now(): Date };
}

export interface ExtensionInstaller {
  installFromFile(path: string): Promise<InstallResult>;
  list(): Promise<InstalledExtension[]>;
  uninstall(id: string): Promise<void>;
  /** Désactive les extensions installées qui figurent dans la liste de révocation (au lancement). */
  applyRevocations(): Promise<{ id: string; reason: string }[]>;
  /** Manifestes des extensions installées et actives, avec leur dossier. */
  active(): Promise<{ manifest: ExtensionManifest; directory: string; signed: boolean }[]>;
}

const cmp = (a: string, b: string) => {
  const x = parseVersion(a) ?? [0, 0, 0];
  const y = parseVersion(b) ?? [0, 0, 0];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

/** Installation, mise à jour, révocation et désinstallation des extensions (§5.3, §12, D13). */
export function createExtensionInstaller(deps: ExtensionInstallerDeps): ExtensionInstaller {
  const registryFile = join(deps.installDir, "installed.json");

  async function readRegistry(): Promise<InstalledExtension[]> {
    try {
      return JSON.parse(await readFile(registryFile, "utf8")) as InstalledExtension[];
    } catch {
      return [];
    }
  }

  async function writeRegistry(list: InstalledExtension[]): Promise<void> {
    await mkdir(deps.installDir, { recursive: true });
    await writeFile(`${registryFile}.tmp`, JSON.stringify(list, null, 2));
    await rename(`${registryFile}.tmp`, registryFile);
  }

  async function installedManifest(id: string): Promise<ExtensionManifest | null> {
    try {
      return JSON.parse(await readFile(join(deps.installDir, id, "manifest.json"), "utf8")) as ExtensionManifest;
    } catch {
      return null;
    }
  }

  async function currentRevocations() {
    const raw = await deps.revocation();
    return raw ? verifyRevocationList(raw, deps.rootPublicKeyPem) : null;
  }

  return {
    async installFromFile(path) {
      let pkg;
      try {
        pkg = readPackage(new Uint8Array(await readFile(path)));
      } catch (err) {
        return { status: "rejected", reason: err instanceof Error ? err.message : String(err) };
      }

      const verification = verifyPackage(pkg, deps.trusted());
      if (verification.status === "invalid") return { status: "rejected", reason: `Signature invalide : ${verification.reason}` };
      if (verification.status === "unsigned" && !deps.devMode())
        return { status: "rejected", reason: "Extension non signée : installable uniquement en mode développeur." };

      const validation = validateManifest(pkg.manifest, { appApi: deps.appApi });
      if (!validation.ok) return { status: "rejected", reason: `Manifeste invalide : ${validation.errors.join(" ; ")}` };
      const m = validation.manifest;
      if (!m.main || !pkg.entries.has(m.main)) return { status: "rejected", reason: `Entrée compilée absente du paquet : ${m.main ?? "(main non déclaré)"}` };

      let revocations;
      try {
        revocations = await currentRevocations();
      } catch {
        revocations = null; // liste illisible ou falsifiée : on ne l'applique pas, sans bloquer l'installation
      }
      const revoked = revocations ? isRevoked(revocations, m.id, m.version) : null;
      if (revoked) return { status: "rejected", reason: `Cette extension a été révoquée : ${revoked.reason}` };

      const previous = await installedManifest(m.id);
      if (previous && cmp(m.version, previous.version) < 0)
        return { status: "rejected", reason: `Version ${m.version} antérieure à la version installée (${previous.version})` };

      const describe = (p: string) => ({ permission: p, description: describePermission(p) });
      const added = previous ? m.permissions.filter((p) => !previous.permissions.includes(p)).map(describe) : [];
      const needsConsent = !previous || added.length > 0 || verification.status === "unsigned";
      if (needsConsent) {
        const ok = await deps.consent({
          kind: previous ? "update" : "install",
          extensionId: m.id,
          version: m.version,
          publisher: m.publisher,
          signed: verification.status === "signed",
          commands: (m.contributes.commands ?? []).map((c) => `${c.title} : ${c.description}`),
          permissions: m.permissions.map(describe),
          added,
          warnings: verification.status === "unsigned" ? ["Extension non signée : son origine et son intégrité ne sont pas garanties."] : [],
        });
        if (!ok) return { status: "declined" };
      }

      // Installation atomique : extraction à côté, puis échange des dossiers.
      const target = join(deps.installDir, m.id);
      const staging = `${target}.nouveau`;
      await rm(staging, { recursive: true, force: true });
      await extractPackage(pkg, staging);
      await rm(`${target}.ancien`, { recursive: true, force: true });
      if (previous) await rename(target, `${target}.ancien`);
      await rename(staging, target);
      await rm(`${target}.ancien`, { recursive: true, force: true });

      const list = (await readRegistry()).filter((e) => e.id !== m.id);
      list.push({ id: m.id, version: m.version, publisher: m.publisher, signed: verification.status === "signed", installedAt: deps.clock.now().toISOString(), disabled: null });
      await writeRegistry(list);
      return { status: "installed", id: m.id, version: m.version };
    },

    list: readRegistry,

    async uninstall(id) {
      await rm(join(deps.installDir, id), { recursive: true, force: true });
      await writeRegistry((await readRegistry()).filter((e) => e.id !== id));
    },

    async applyRevocations() {
      const revocations = await currentRevocations();
      if (!revocations) return [];
      const list = await readRegistry();
      const disabled: { id: string; reason: string }[] = [];
      for (const e of list) {
        const hit = isRevoked(revocations, e.id, e.version);
        if (hit && !e.disabled) {
          e.disabled = `Révoquée : ${hit.reason}`;
          disabled.push({ id: e.id, reason: hit.reason });
        }
      }
      if (disabled.length) await writeRegistry(list);
      return disabled;
    },

    async active() {
      const out: { manifest: ExtensionManifest; directory: string; signed: boolean }[] = [];
      for (const e of await readRegistry()) {
        if (e.disabled) continue;
        const manifest = await installedManifest(e.id);
        if (manifest) out.push({ manifest, directory: join(deps.installDir, e.id), signed: e.signed });
      }
      return out;
    },
  };
}
