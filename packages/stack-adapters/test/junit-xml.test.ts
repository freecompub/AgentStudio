import { describe, expect, it } from "vitest";
import { parseXunit } from "../src/reports/junit-xml.js";

const XUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
<testsuite name="TestResults" errors="0" tests="3" failures="1" time="0.01">
<testcase classname="BolusTests.CapTests" name="testUnderCap" time="0.0001">
</testcase>
<testcase classname="BolusTests.CapTests" name="testOverCap" time="0.0002">
<failure message="failed"></failure>
</testcase>
<testcase classname="BolusTests.CapTests" name="testLater" time="0">
<skipped/>
</testcase>
</testsuite>
</testsuites>`;

describe("Rapport JUnit XML", () => {
  it("JUnit : identifiants module.classe/méthode, statuts, message de l'échec", () => {
    // Le message porte la raison de l'échec : les profils de stack s'en servent pour distinguer
    // un rouge légitime d'une erreur de syntaxe (lecteur `junit-xml`).
    expect(parseXunit(XUNIT)).toEqual([
      { classname: "BolusTests.CapTests", name: "testUnderCap", status: "passed" },
      { classname: "BolusTests.CapTests", name: "testOverCap", status: "failed", message: expect.any(String) },
      { classname: "BolusTests.CapTests", name: "testLater", status: "skipped" },
    ]);
  });

  it("JUnit : entités XML décodées, balises autofermantes", () => {
    const xml = `<testsuites><testsuite><testcase classname="A.B" name="test_a&amp;b" time="0"/></testsuite></testsuites>`;
    expect(parseXunit(xml)).toEqual([{ classname: "A.B", name: "test_a&b", status: "passed" }]);
  });
});
