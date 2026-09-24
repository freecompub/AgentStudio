import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyzeSwiftImports, parseSwiftImports } from "../src/swift/swift-architecture.js";

describe("Imports Swift", () => {
  it("reconnaît toutes les formes d'import, ignore commentaires et chaînes", () => {
    const src = `// import Commentaire
import Foundation
@testable import Domain
import struct Infrastructure.Http
@_exported import Settings
/* import Bloc */
let s = "import Chaine"
  import  Indente`;
    expect(parseSwiftImports(src)).toEqual(["Foundation", "Domain", "Infrastructure", "Settings", "Indente"]);
  });
});

describe("Règle de dépendance entre modules Swift", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "agent-studio-swiftarch-"));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const put = async (rel: string, content: string) => {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), content);
  };

  it("modules = dossiers de Sources/ ; violations par fichier", async () => {
    await put("Sources/Domain/Bolus.swift", "import Foundation\n");
    await put("Sources/Domain/Policy/Cap.swift", "import Infrastructure\n");
    await put("Sources/Infrastructure/Http.swift", "import Domain\nimport Foundation\n");
    await put("Tests/DomainTests/T.swift", "import Infrastructure\n");
    const r = await analyzeSwiftImports(root, [{ module: "Domain", forbidden: ["Infrastructure"] }]);
    expect(r.modules).toEqual([
      { name: "Domain", imports: ["Foundation", "Infrastructure"] },
      { name: "Infrastructure", imports: ["Domain", "Foundation"] },
    ]);
    expect(r.violations).toEqual([{ module: "Domain", file: "Sources/Domain/Policy/Cap.swift", imported: "Infrastructure" }]);
  });

  it("projet sans Sources : rien à analyser", async () => {
    expect(await analyzeSwiftImports(root, [])).toEqual({ modules: [], violations: [] });
  });
});
