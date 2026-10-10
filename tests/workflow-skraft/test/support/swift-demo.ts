// Copie de extensions/skraft/test/support/swift-demo.ts (2026-10-08).
/** Projet Swift de démonstration de US-12 (SPEC-skraft §13.3) et contenus écrits par les agents simulés. */
import { createProject, git, put } from "./harness.js";

export const PACKAGE = `// swift-tools-version:5.9
import PackageDescription
let package = Package(name: "Bolus", targets: [
  .target(name: "Domain"),
  .target(name: "Settings", dependencies: ["Domain"]),
  .testTarget(name: "DomainTests", dependencies: ["Domain"]),
  .testTarget(name: "AcceptanceTests", dependencies: ["Domain"]),
])
`;

export const CALCULATOR = `public struct BolusCalculator {
  public init() {}
  public func propose(calcul: Double) -> Double { calcul }
}
`;

/** Signatures minimales écrites en DISTILL pour que les tests d'acceptance compilent (§7.3). */
export const STUB = `public struct MaxBolus: Equatable {
  public let units: Double
  public init(units: Double) { self.units = units }
}

public struct CappedDose: Equatable {
  public let units: Double
  public let alert: String?
  public init(units: Double, alert: String?) { self.units = units; self.alert = alert }
}

extension BolusCalculator {
  public func propose(calcul: Double, max: MaxBolus) -> CappedDose { CappedDose(units: 0, alert: nil) }
}
`;

export const ACCEPTANCE = `import XCTest
@testable import Domain

final class BolusCapAcceptanceTests: XCTestCase {
  // ac-1 : plafond de 10 U, calcul à 6 U
  func testAc1DoseSousLePlafond() {
    XCTAssertEqual(BolusCalculator().propose(calcul: 6, max: MaxBolus(units: 10)), CappedDose(units: 6, alert: nil))
  }

  // ac-2 : plafond de 10 U, calcul à 12,5 U
  func testAc2DosePlafonnee() {
    XCTAssertEqual(BolusCalculator().propose(calcul: 12.5, max: MaxBolus(units: 10)), CappedDose(units: 10, alert: "Dose plafonnée à 10 U"))
  }

  // ac-3 : aucun plafond configuré
  func testAc3AucunPlafond() {
    XCTAssertEqual(BolusCalculator().propose(calcul: 7), 7)
  }
}
`;

export const UNIT_TEST = `import XCTest
@testable import Domain

final class BolusCapPolicyTests: XCTestCase {
  func testKeepsDoseUnderMax() {
    XCTAssertEqual(BolusCapPolicy(max: MaxBolus(units: 10)).apply(6), CappedDose(units: 6, alert: nil))
  }
}
`;

export const POLICY = `public struct BolusCapPolicy {
  public let max: MaxBolus

  public init(max: MaxBolus) { self.max = max }

  public func apply(_ dose: Double) -> CappedDose {
    guard dose > max.units else { return CappedDose(units: dose, alert: nil) }
    return CappedDose(units: max.units, alert: "Dose plafonnée à \\(Int(max.units)) U")
  }
}
`;

export async function createSwiftProject(): Promise<string> {
  const root = await createProject();
  await put(root, ".gitignore", ".build\n");
  await put(root, "Package.swift", PACKAGE);
  await put(root, "Sources/Domain/BolusCalculator.swift", CALCULATOR);
  await put(root, "Tests/DomainTests/BolusCalculatorTests.swift", "import XCTest\n@testable import Domain\n\nfinal class BolusCalculatorTests: XCTestCase {\n  func testProposesCalculatedDose() { XCTAssertEqual(BolusCalculator().propose(calcul: 7), 7) }\n}\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "projet Swift");
  return root;
}

