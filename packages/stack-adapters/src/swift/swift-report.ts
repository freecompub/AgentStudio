import { relatifDepuis } from "../chemin-relatif.js";
import type { FailureKind } from "../protocols.js";

export interface XunitCase {
  classname: string;
  name: string;
  status: "passed" | "failed" | "skipped";
  /** Message porté par `<failure>` ou `<error>` : sans lui, la raison de l'échec est inconnue. */
  message?: string;
}

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decode(m[1]!) : "";
};

/** Rapport JUnit de `swift test --xunit-output` (format simple et stable : lecture ciblée). */
export function parseXunit(xml: string): XunitCase[] {
  const cases: XunitCase[] = [];
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const tag = m[1] ?? "";
    const body = m[3] ?? "";
    const status: XunitCase["status"] = /<(failure|error)\b/.test(body) ? "failed" : /<skipped\b/.test(body) ? "skipped" : "passed";
    // Le message vit dans l'attribut `message`, sinon dans le contenu de la balise.
    const balise = /<(?:failure|error)\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:failure|error)>)/.exec(body);
    const message = balise ? attr(` ${balise[1] ?? ""}`, "message") || decode((balise[2] ?? "").trim()) : "";
    cases.push({ classname: attr(` ${tag}`, "classname"), name: attr(` ${tag}`, "name"), status, ...(message ? { message } : {}) });
  }
  return cases;
}

const rel = relatifDepuis;

/**
 * Échecs XCTest dans la sortie standard : `<fichier>:<ligne>: error: <Classe>.<méthode> : <message>`.
 * Une assertion XCTAssert* est une bonne raison d'être rouge ; un plantage ne l'est pas.
 */
export function parseXcTestFailures(output: string, root: string): Map<string, { file: string; message: string; failureKind: FailureKind }> {
  const out = new Map<string, { file: string; message: string; failureKind: FailureKind }>();
  const re = /^(.+\.swift):\d+: error: (\S+?)\.(\S+) : (.*)$/gm;
  for (let m = re.exec(output); m; m = re.exec(output)) {
    const key = `${m[2]}.${m[3]}`;
    if (out.has(key)) continue;
    const message = m[4]!.trim();
    out.set(key, { file: rel(root, m[1]!), message, failureKind: /^XCT(Assert|Fail|Unwrap)/.test(message) ? "assertion" : "other_error" });
  }
  return out;
}

/** Erreurs du compilateur Swift (`<fichier>:<ligne>:<col>: error: <message>`). */
export function parseSwiftBuildErrors(output: string, root: string): { file: string; message: string }[] {
  const errors: { file: string; message: string }[] = [];
  const re = /^(.+\.swift):\d+:\d+: error: (.*)$/gm;
  for (let m = re.exec(output); m; m = re.exec(output)) errors.push({ file: rel(root, m[1]!), message: m[2]!.trim() });
  return errors;
}

const MISSING = /cannot find (type )?'[^']+' in scope|no such module|has no member|missing argument for parameter|extra argument|module '[^']+' has no member/;

/** En Swift, un symbole absent empêche la compilation : c'est la forme « symbole manquant » du rouge. */
export function classifySwiftBuildError(message: string): FailureKind {
  return MISSING.test(message) ? "missing_symbol" : "other_error";
}
