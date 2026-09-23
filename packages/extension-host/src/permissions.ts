import type { ExtensionManifest, Permission } from "@agent-studio/extension-api";

export class PermissionDeniedError extends Error {
  constructor(readonly extensionId: string, readonly permission: string) {
    super(`Permission non déclarée par ${extensionId} : ${permission}`);
    this.name = "PermissionDeniedError";
  }
}

/** Une capacité non déclarée dans le manifeste est refusée, même si l'utilisateur l'autoriserait (D11). */
export function permissionChecker(manifest: ExtensionManifest) {
  const granted = new Set<string>(manifest.permissions);
  return {
    has: (p: Permission) => granted.has(p),
    require(p: Permission): void {
      if (!granted.has(p)) throw new PermissionDeniedError(manifest.id, p);
    },
    /** Globs d'écriture déclarés (`fs:write:<glob>`). */
    writeGlobs: (): string[] => manifest.permissions.filter((p) => p.startsWith("fs:write:")).map((p) => p.slice("fs:write:".length)),
  };
}
