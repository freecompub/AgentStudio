export interface XunitCase {
  classname: string;
  name: string;
  status: "passed" | "failed" | "skipped";
  /** Message porté par `<failure>` ou `<error>` : sans lui, la raison de l'échec est inconnue. */
  message?: string;
  /**
   * Ce sur quoi classer l'échec : l'attribut `type` (JUnit), le message, et la dernière ligne du corps,
   * où pytest écrit le type d'exception (« tests/a.py:4: AssertionError »). Jamais le corps entier :
   * pytest y recopie le code du test, et un `assertEqual(` plus haut ferait d'une ValueError une assertion.
   */
  raison?: string;
}

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decode(m[1]!) : "";
};

/** Rapport JUnit XML (format simple et stable : lecture ciblée). */
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
    const derniereLigne = balise ? decode(balise[2] ?? "").trim().split("\n").at(-1)?.trim() ?? "" : "";
    const raison = balise ? [attr(` ${balise[1] ?? ""}`, "type"), message, derniereLigne].filter(Boolean).join("\n") : "";
    cases.push({ classname: attr(` ${tag}`, "classname"), name: attr(` ${tag}`, "name"), status, ...(message ? { message } : {}), ...(raison ? { raison } : {}) });
  }
  return cases;
}
