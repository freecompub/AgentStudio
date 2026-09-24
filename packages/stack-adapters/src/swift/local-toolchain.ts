import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SwiftToolchain } from "./swift-adapter.js";

/**
 * Chaîne Swift installée hors système dans `~/.cache/agent-studio/swift` (ou `$AGENT_STUDIO_SWIFT_HOME`),
 * avec son dossier de compatibilité (`compat/` : libxml2, objets GCC, lld) pour les distributions
 * plus récentes que celle de la chaîne. `null` si absente.
 */
export function findLocalSwiftToolchain(): SwiftToolchain | null {
  const home = process.env["AGENT_STUDIO_SWIFT_HOME"] ?? join(homedir(), ".cache", "agent-studio", "swift");
  if (!existsSync(home)) return null;
  const release = readdirSync(home).find((d) => d.startsWith("swift-") && existsSync(join(home, d, "usr/bin/swift")));
  if (!release) return null;
  const bin = join(home, release, "usr/bin");
  const compat = join(home, "compat");
  const env: Record<string, string> = { PATH: `${bin}:${process.env["PATH"] ?? ""}` };
  if (existsSync(compat)) {
    env["LD_LIBRARY_PATH"] = compat;
    if (existsSync(join(compat, "root/usr/lib/gcc"))) env["CCC_OVERRIDE_OPTIONS"] = `^--gcc-toolchain=${join(compat, "root/usr")} ^-fuse-ld=lld`;
  }
  return { swift: join(bin, "swift"), env };
}
