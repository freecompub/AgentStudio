/**
 * Une pile éprouvable en CI (ADR 0076) : `node --test`, que la machine de test possède toujours, avec
 * ses quatre canaris. Partagée par les tests des services et du serveur MCP, qui la font vérifier
 * pour de vrai dans une copie du projet.
 */
const canari = (kind: string, corps: string) =>
  `  - kind: ${kind}\n    file: tests/canari_{marque}.test.mjs\n    content: |\n      import test from "node:test";\n      import assert from "node:assert";\n      ${corps}\n`;

export const PILE_NODE =
  'id: maison\ndetect: [package.json]\ntests:\n  command: [node, --test, --test-reporter=tap]\n  report: tap\nlayout:\n  unitTests: ["tests/**"]\n  sources: ["src/**"]\nbdd: false\ncanaries:\n' +
  canari("passed", 'test("canari {marque}", () => {});') +
  canari("assertion", 'test("canari {marque}", () => { assert.strictEqual(1, 2); });') +
  canari("missing_symbol", 'test("canari {marque}", () => { fonctionAbsente_{marque}(); });') +
  canari("syntax", 'test("canari {marque}", () => { :::');

/** Les fichiers d'un projet minimal que cette pile reconnaît et teste. */
export const FICHIERS_NODE: Record<string, string> = {
  "package.json": '{ "name": "demo", "type": "module" }\n',
  "tests/a.test.mjs": 'import test from "node:test";\ntest("a", () => {});\n',
  "src/a.mjs": "export const a = 1;\n",
};
