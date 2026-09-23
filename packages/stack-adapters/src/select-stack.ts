import type { StackAdapter } from "./protocols.js";

/** Premier adaptateur qui reconnaît le projet, dans l'ordre donné ; `null` si aucun. */
export async function selectStackAdapter(root: string, adapters: StackAdapter[]): Promise<StackAdapter | null> {
  for (const a of adapters) if (await a.detect(root)) return a;
  return null;
}
