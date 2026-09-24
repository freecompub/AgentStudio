import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { z } from "zod";

/** Liste de révocation (§12) : signée par la clé racine de l'application, interrogée périodiquement. */
const listSchema = z.object({
  issuedAt: z.string(),
  revoked: z.array(z.object({ id: z.string(), versions: z.array(z.string()).optional(), reason: z.string() })),
});

export type RevocationList = z.infer<typeof listSchema>;
export type SignedRevocationList = RevocationList & { signature: string };

const canonical = (l: RevocationList) =>
  JSON.stringify({ issuedAt: l.issuedAt, revoked: l.revoked.map((r) => ({ id: r.id, versions: r.versions ?? null, reason: r.reason })) });

export function signRevocationList(list: RevocationList, rootPrivateKeyPem: string): SignedRevocationList {
  return { ...list, signature: sign(null, Buffer.from(canonical(list)), createPrivateKey(rootPrivateKeyPem)).toString("base64") };
}

/** Vérifie la signature et renvoie la liste ; lève si elle a été altérée. */
export function verifyRevocationList(signed: unknown, rootPublicKeyPem: string): RevocationList {
  const parsed = listSchema.extend({ signature: z.string() }).safeParse(signed);
  if (!parsed.success) throw new Error("Liste de révocation illisible");
  const { signature, ...list } = parsed.data;
  let ok = false;
  try {
    ok = verify(null, Buffer.from(canonical(list)), createPublicKey(rootPublicKeyPem), Buffer.from(signature, "base64"));
  } catch {
    ok = false;
  }
  if (!ok) throw new Error("Liste de révocation refusée : signature invalide");
  return JSON.parse(JSON.stringify(list)) as RevocationList;
}

export function isRevoked(list: RevocationList, id: string, version: string): { reason: string } | null {
  const hit = list.revoked.find((r) => r.id === id && (!r.versions || r.versions.includes(version)));
  return hit ? { reason: hit.reason } : null;
}
