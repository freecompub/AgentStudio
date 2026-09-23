/**
 * Adaptateur Swift sur une vraie chaîne SwiftPM. Sauté si aucune chaîne n'est disponible
 * (`~/.cache/agent-studio/swift` ou `$AGENT_STUDIO_SWIFT_HOME`).
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSwiftAdapter } from "../src/swift/swift-adapter.js";
import { findLocalSwiftToolchain } from "../src/swift/local-toolchain.js";

const toolchain = findLocalSwiftToolchain();

describe.skipIf(!toolchain)("Adaptateur Swift (chaîne réelle)", () => {
  const adapter = createSwiftAdapter({ toolchain: toolchain! });
  let root: string;
  const put = async (rel: string, content: string) => {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), content);
  };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "agent-studio-swift-"));
    await put(
      "Package.swift",
      `// swift-tools-version:5.9
import PackageDescription
let package = Package(name: "Demo", targets: [.target(name: "Domain"), .testTarget(name: "DomainTests", dependencies: ["Domain"])])
`,
    );
    await put("Sources/Domain/Bolus.swift", "public func cap(_ dose: Double, _ max: Double) -> Double { Swift.min(dose, max) }\n");
    await put(
      "Tests/DomainTests/CapTests.swift",
      `import XCTest
@testable import Domain
final class CapTests: XCTestCase {
  func testUnderCap() { XCTAssertEqual(cap(6, 10), 6) }
  func testOverCap() { XCTAssertEqual(cap(12.5, 10), 11) }
}
`,
    );
  });
  afterAll(() => rm(root, { recursive: true, force: true }));

  it("reconnaît un paquet SwiftPM", async () => {
    expect(await adapter.detect(root)).toBe(true);
  });

  it("résultats structurés : réussite et échec sur assertion", async () => {
    const run = await adapter.runTests({ root });
    expect(run.timedOut).toBe(false);
    expect(run.results).toEqual([
      expect.objectContaining({ id: "DomainTests.CapTests/testOverCap", file: "Tests/DomainTests/CapTests.swift", status: "failed", failureKind: "assertion" }),
      { id: "DomainTests.CapTests/testUnderCap", file: "", status: "passed" },
    ]);
  }, 300_000);

  it("symbole manquant : la compilation échoue, le fichier de test est rouge pour une bonne raison", async () => {
    await put("Tests/DomainTests/AlertTests.swift", `import XCTest\n@testable import Domain\nfinal class AlertTests: XCTestCase {\n  func testAlert() { XCTAssertEqual(alert(12.5, 10), "x") }\n}\n`);
    const run = await adapter.runTests({ root });
    expect(run.results).toEqual([
      { id: "Tests/DomainTests/AlertTests.swift", file: "Tests/DomainTests/AlertTests.swift", status: "failed", failureKind: "missing_symbol", message: "cannot find 'alert' in scope" },
    ]);
    await rm(join(root, "Tests/DomainTests/AlertTests.swift"));
  }, 300_000);

  it("analyse des imports", async () => {
    const r = await adapter.architecture!({ root, rules: [{ module: "Domain", forbidden: ["Foundation"] }] });
    expect(r).toEqual({ modules: [{ name: "Domain", imports: [] }], violations: [] });
  });

  it("fichiers de test : sous Tests/", () => {
    expect(adapter.isTestFile("Tests/DomainTests/CapTests.swift")).toBe(true);
    expect(adapter.isTestFile("Sources/Domain/Bolus.swift")).toBe(false);
  });
});
