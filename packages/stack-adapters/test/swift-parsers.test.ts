import { describe, expect, it } from "vitest";
import { classifySwiftBuildError, parseSwiftBuildErrors, parseXcTestFailures, parseXunit } from "../src/swift/swift-report.js";

const XUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
<testsuite name="TestResults" errors="0" tests="3" failures="1" time="0.01">
<testcase classname="CapTests.CapTests" name="testUnderCap" time="0.0001">
</testcase>
<testcase classname="CapTests.CapTests" name="testOverCap" time="0.0002">
<failure message="failed"></failure>
</testcase>
<testcase classname="CapTests.CapTests" name="testLater" time="0">
<skipped/>
</testcase>
</testsuite>
</testsuites>`;

const STDOUT = `Test Suite 'All tests' started at 2026-09-23 10:00:00.000
Test Case 'CapTests.testOverCap' started at 2026-09-23 10:00:00.001
/projet/Tests/CapTests/CapTests.swift:9: error: CapTests.testOverCap : XCTAssertEqual failed: ("12.5") is not equal to ("10.0") - dose plafonnée
Test Case 'CapTests.testOverCap' failed (0.001 seconds)
/projet/Tests/CapTests/CrashTests.swift:4: error: CrashTests.testCrash : failed - Fatal error: Index out of range
`;

describe("Rapport Swift", () => {
  it("JUnit : identifiants module.classe/méthode, statuts", () => {
    expect(parseXunit(XUNIT)).toEqual([
      { classname: "CapTests.CapTests", name: "testUnderCap", status: "passed" },
      { classname: "CapTests.CapTests", name: "testOverCap", status: "failed" },
      { classname: "CapTests.CapTests", name: "testLater", status: "skipped" },
    ]);
  });

  it("JUnit : entités XML décodées, balises autofermantes", () => {
    const xml = `<testsuites><testsuite><testcase classname="A.B" name="test_a&amp;b" time="0"/></testsuite></testsuites>`;
    expect(parseXunit(xml)).toEqual([{ classname: "A.B", name: "test_a&b", status: "passed" }]);
  });

  it("sortie XCTest : message, fichier et nature de chaque échec", () => {
    expect(parseXcTestFailures(STDOUT, "/projet")).toEqual(
      new Map([
        ["CapTests.testOverCap", { file: "Tests/CapTests/CapTests.swift", message: 'XCTAssertEqual failed: ("12.5") is not equal to ("10.0") - dose plafonnée', failureKind: "assertion" }],
        ["CrashTests.testCrash", { file: "Tests/CapTests/CrashTests.swift", message: "failed - Fatal error: Index out of range", failureKind: "other_error" }],
      ]),
    );
  });

  it("erreurs de compilation : fichier relatif, message, nature", () => {
    const out = `Building for debugging...
/projet/Tests/CapTests/CapTests.swift:5:20: error: cannot find 'cap' in scope
/projet/Tests/CapTests/CapTests.swift:6:9: error: cannot find 'cap' in scope
/projet/Sources/Domain/Bolus.swift:3:1: error: expected declaration
error: fatalError`;
    expect(parseSwiftBuildErrors(out, "/projet")).toEqual([
      { file: "Tests/CapTests/CapTests.swift", message: "cannot find 'cap' in scope" },
      { file: "Tests/CapTests/CapTests.swift", message: "cannot find 'cap' in scope" },
      { file: "Sources/Domain/Bolus.swift", message: "expected declaration" },
    ]);
  });

  it.each([
    ["cannot find 'cap' in scope", "missing_symbol"],
    ["cannot find type 'MaxBolus' in scope", "missing_symbol"],
    ["no such module 'Domain'", "missing_symbol"],
    ["value of type 'Bolus' has no member 'capped'", "missing_symbol"],
    ["type 'Bolus' has no member 'cap'", "missing_symbol"],
    ["missing argument for parameter 'max' in call", "missing_symbol"],
    ["expected declaration", "other_error"],
    ["cannot convert value of type 'Int' to expected argument type 'Double'", "other_error"],
  ] as const)("%s → %s", (msg, kind) => {
    expect(classifySwiftBuildError(msg)).toBe(kind);
  });
});

describe("parseTestClasses", () => {
  it("classes déclarées, commentaires ignorés", async () => {
    const { parseTestClasses } = await import("../src/swift/swift-adapter.js");
    expect(parseTestClasses("// class Ancienne: XCTestCase {}\nfinal class CapTests: XCTestCase {}\n/* class X: Y */\nclass Aide: NSObject {}\n")).toEqual(["CapTests", "Aide"]);
  });
});
