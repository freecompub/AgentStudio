import { describe, expect, it } from "vitest";
import { resolveInside, PathOutsideWorkspaceError } from "../src/files/paths.js";

describe("resolveInside", () => {
  const root = "/projets/demo";

  it("résout un chemin relatif sous la racine", () => {
    expect(resolveInside(root, "src/a.ts")).toBe("/projets/demo/src/a.ts");
  });

  it("normalise les segments intermédiaires", () => {
    expect(resolveInside(root, "src/../tests/./b.ts")).toBe("/projets/demo/tests/b.ts");
  });

  it.each(["../x", "src/../../x", "/etc/passwd", "..", "../demo2/a"])(
    "refuse %s qui sort de la racine",
    (rel) => {
      expect(() => resolveInside(root, rel)).toThrow(PathOutsideWorkspaceError);
    },
  );

  it("refuse la racine elle-même comme fichier cible", () => {
    expect(() => resolveInside(root, ".")).toThrow(PathOutsideWorkspaceError);
  });

  it("refuse tout accès au dossier .git", () => {
    expect(() => resolveInside(root, ".git/config")).toThrow(PathOutsideWorkspaceError);
    expect(() => resolveInside(root, "sub/.git/hooks/pre-commit")).toThrow(PathOutsideWorkspaceError);
  });

  it("refuse les octets nuls", () => {
    expect(() => resolveInside(root, "a\0b")).toThrow(PathOutsideWorkspaceError);
  });
});
