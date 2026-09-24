import { adrId, parseAdr, parseSupersessions } from "./adr.js";
import { extractPascalIdentifiers } from "./text-analysis.js";

/** Documents de conception attendus (§6.2) et sources des noms du modèle. */
export const MODEL_DOCS = ["event-model.md", "domain-model.md"] as const;
export const CITING_DOCS = ["contracts.md", "diagrams.md"] as const;

export interface DesignInput {
  /** Contenu des documents de `.skraft/<slug>/design/`, par nom de fichier. */
  docs: Record<string, string>;
  /** Tous les ADR du dépôt après la phase ; `isNew` pour ceux créés pendant la phase. */
  adrs: { path: string; md: string; isNew: boolean }[];
  supersessions: string;
  /** ADR qui existaient au début de la phase et ont été modifiés ou supprimés. */
  modifiedExistingAdrs: string[];
}

/**
 * Porte cohérence (code) : en-têtes des nouveaux ADR, numérotation continue, noms cités présents
 * dans le modèle, remplacements consignés des deux côtés, ADR existants inchangés.
 */
export function checkDesign(i: DesignInput): string[] {
  const reasons: string[] = [];

  if (i.docs["event-model.md"] === undefined) reasons.push("Document de conception manquant : event-model.md.");
  const known = new Set(MODEL_DOCS.flatMap((d) => extractPascalIdentifiers(i.docs[d] ?? "")));
  for (const doc of CITING_DOCS) {
    for (const id of extractPascalIdentifiers(i.docs[doc] ?? ""))
      if (!known.has(id)) reasons.push(`\`${id}\` cité dans ${doc} n'existe pas dans ${MODEL_DOCS.join(" ni dans ")}.`);
  }

  for (const p of i.modifiedExistingAdrs)
    reasons.push(`ADR existant modifié : ${p} (les ADR sont append-only ; en rédiger un nouveau qui le remplace).`);

  const parsed = i.adrs.map((a) => ({ ...a, adr: parseAdr(a.md) }));
  for (const a of parsed.filter((x) => x.isNew)) {
    if (!a.adr.id) reasons.push(`${a.path} : titre « # ADR-NNN — titre » absent.`);
    for (const m of a.adr.missing) reasons.push(`${a.path} : section manquante « ${m} ».`);
    if (a.adr.status && a.adr.status !== "Proposed") reasons.push(`${a.path} : statut ${a.adr.status}, Proposed attendu.`);
  }

  const numbers = parsed.map((a) => a.adr.number).filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  const seen = new Set<number>();
  for (const n of numbers) {
    if (seen.has(n)) reasons.push(`Numérotation des ADR : ${adrId(n)} en double.`);
    seen.add(n);
  }
  // Seuls les trous que cette phase creuse sont reprochés : un ADR archivé avant la story
  // laisse un trou que l'agent ne peut pas combler, et le lui reprocher ferait échouer DESIGN
  // à chaque tentative, jusqu'à épuisement du budget.
  const dejaLa = parsed.filter((a) => !a.isNew).map((a) => a.adr.number).filter((n) => Number.isFinite(n));
  const depuis = (dejaLa.length ? Math.max(...dejaLa) : 0) + 1;
  const max = numbers.at(-1) ?? 0;
  for (let n = depuis; n <= max; n++) if (!seen.has(n)) reasons.push(`Numérotation des ADR : ${adrId(n)} manque.`);

  const registry = parseSupersessions(i.supersessions);
  for (const a of parsed.filter((x) => x.isNew))
    for (const replaced of a.adr.supersedes)
      if (!registry.some((r) => r.by === a.adr.id && r.replaced === replaced))
        reasons.push(`${a.adr.id} remplace ${replaced} mais le registre supersessions.md ne le mentionne pas.`);
  for (const r of registry) {
    const by = parsed.find((a) => a.adr.id === r.by);
    if (!by?.adr.supersedes.includes(r.replaced)) reasons.push(`supersessions.md indique qu'${r.by} remplace ${r.replaced}, mais ${r.by} ne le déclare pas.`);
  }
  return reasons;
}
