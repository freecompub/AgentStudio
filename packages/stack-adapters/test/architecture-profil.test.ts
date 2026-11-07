/**
 * Analyse des imports déclarée par un profil (ADR 0072, point 2) : la règle de dépendance (« le
 * domaine n'importe pas l'infrastructure ») redevient vérifiable pour toute pile. L'analyse est
 * textuelle : un motif par ligne, borné comme `buildErrors`.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProfileAdapter } from "../src/profile/profile-adapter.js";
import { parseStackProfile } from "../src/profile/stack-profile.js";

const CSHARP = `
architecture:
  fichiers: ["src/**/*.cs"]
  import: '^\\s*using\\s+(?<module>[\\w.]+)\\s*;'
  modules:
    Domain: ["src/Tarification.Domaine/**"]
    Application: ["src/Tarification.Application/**"]
`;
const PROFIL = (architecture: string) => `
id: dotnet
detect: [Tarification.sln]
tests:
  command: [dotnet, test]
  report: junit-xml
layout:
  unitTests: ["tests/**"]
  sources: ["src/**"]
${architecture}`;
const lire = (architecture: string) => parseStackProfile(PROFIL(architecture), { allowedPrograms: ["dotnet"] });
const adaptateur = (architecture: string) => {
  const r = lire(architecture);
  if ("error" in r) throw new Error(r.error);
  return createProfileAdapter(r.profile);
};

let racine: string;
const ecrire = async (chemin: string, contenu: string) => {
  await mkdir(dirname(join(racine, chemin)), { recursive: true });
  await writeFile(join(racine, chemin), contenu);
};
beforeEach(async () => {
  racine = await mkdtemp(join(tmpdir(), "architecture-"));
});
afterEach(() => rm(racine, { recursive: true, force: true }));

describe("Analyse des imports d'un profil (ADR 0072)", () => {
  it("sans section `architecture`, pas d'analyse : la porte dit qu'elle n'a rien vérifié", () => {
    expect(adaptateur("").architecture).toBeUndefined();
  });

  it("modules et imports ; une règle par nom de module ; un segment interdit suffit, pas une sous-chaîne", async () => {
    await ecrire("src/Tarification.Domaine/Plafond.cs", "using System;\nusing Tarification.Infrastructure.Db;\nnamespace Tarification.Domaine;\n");
    await ecrire("src/Tarification.Domaine/Dose.cs", "using Tarification.Infra;\n");
    await ecrire("src/Tarification.Application/Service.cs", "using Tarification.Infrastructure.Db;\n");
    await ecrire("src/Outils/Hors.cs", "using Tarification.Infrastructure;\n");
    const r = await adaptateur(CSHARP).architecture!({ root: racine, rules: [{ module: "Domain", forbidden: ["Infrastructure"] }] });
    expect(r.modules).toEqual([
      { name: "Application", imports: ["Tarification.Infrastructure.Db"] },
      { name: "Domain", imports: ["System", "Tarification.Infra", "Tarification.Infrastructure.Db"] },
    ]);
    expect(r.violations).toEqual([{ module: "Domain", file: "src/Tarification.Domaine/Plafond.cs", imported: "Tarification.Infrastructure.Db" }]);
  });

  it("une règle par chemin vise les fichiers sous ce dossier ; un import relatif est résolu depuis le fichier", async () => {
    const ts = `
architecture:
  fichiers: ["src/**/*.ts"]
  import: 'from\\s+["''](?<module>[^"'']+)["'']'
  modules:
    Domain: ["src/domain/**"]
`;
    await ecrire("src/domain/plafond.ts", 'import { db } from "../infrastructure/db.js";\nimport express from "express";\nimport { Dose } from "./dose.js";\n');
    const r = await adaptateur(ts).architecture!({ root: racine, rules: [{ module: "src/domain", forbidden: ["src/infrastructure", "express"] }] });
    expect(r.violations).toEqual([
      { module: "Domain", file: "src/domain/plafond.ts", imported: "src/infrastructure/db.js" },
      { module: "Domain", file: "src/domain/plafond.ts", imported: "express" },
    ]);
  });

  it("dossiers de dépendances et cachés ignorés ; fichier démesuré non lu", async () => {
    await ecrire("src/Tarification.Domaine/node_modules/x/A.cs", "using Tarification.Infrastructure;\n");
    await ecrire("src/Tarification.Domaine/.cache/B.cs", "using Tarification.Infrastructure;\n");
    await ecrire("src/Tarification.Domaine/Gros.cs", `using Tarification.Infrastructure;\n${"// x\n".repeat(300_000)}`);
    const r = await adaptateur(CSHARP).architecture!({ root: racine, rules: [{ module: "Domain", forbidden: ["Infrastructure"] }] });
    expect(r.violations).toEqual([]);
  });

  it("le motif est gardé comme celui de buildErrors : groupe `module` exigé, quantificateur imbriqué refusé", () => {
    expect(lire(CSHARP.replace("(?<module>", "("))).toEqual({ error: expect.stringMatching(/architecture\.import.*\(\?<module>/) });
    expect(lire(CSHARP.replace("[\\w.]+", "([\\w.]+)+"))).toEqual({ error: expect.stringMatching(/architecture\.import.*imbriqué/) });
    expect(lire(CSHARP.replace("    Application:", "    Autre: [] \n    Application:"))).toEqual({ error: expect.stringMatching(/architecture\.modules/) });
  });
});
