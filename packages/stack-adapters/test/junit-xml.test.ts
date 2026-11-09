import { describe, expect, it } from "vitest";
import { parseXunit } from "../src/reports/junit-xml.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lireTests } from "../src/profile/read-report.js";

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
      { classname: "BolusTests.CapTests", name: "testOverCap", status: "failed", message: expect.any(String), raison: expect.any(String) },
      { classname: "BolusTests.CapTests", name: "testLater", status: "skipped" },
    ]);
  });

  it("JUnit : entités XML décodées, balises autofermantes", () => {
    const xml = `<testsuites><testsuite><testcase classname="A.B" name="test_a&amp;b" time="0"/></testsuite></testsuites>`;
    expect(parseXunit(xml)).toEqual([{ classname: "A.B", name: "test_a&b", status: "passed" }]);
  });
});

/**
 * Vraie sortie de pytest 9.2 (`fixtures/pytest-9.2.xml`, racine réécrite en `/projet`), vue à l'essai
 * du 09/11 : l'attribut `message` d'une assertion n'est que l'expression (« assert 1 == 2 ») ; le type
 * d'exception est sur la dernière ligne du corps. Classer sur le corps entier serait faux : pytest y
 * recopie le code du test, et un `assertEqual(` plus haut ferait d'une ValueError une assertion.
 */
describe("junit-xml : classement des échecs d'un vrai rapport pytest", () => {
  const xml = readFileSync(join(import.meta.dirname, "fixtures/pytest-9.2.xml"), "utf8");
  it("assertion, symbole manquant, autre erreur", () => {
    const parType = Object.fromEntries(lireTests("junit-xml", xml, "/projet").map((r) => [r.id.split(/[.:]/).at(-1), r.failureKind]));
    expect(parType).toEqual({ test_assertion: "assertion", test_symbole: "missing_symbol", test_autre_erreur: "other_error" });
  });

  it("le message montré reste celui de l'attribut", () => {
    expect(lireTests("junit-xml", xml, "/projet").find((r) => r.id.endsWith("test_assertion"))?.message).toBe("assert 1 == 2");
  });
});
