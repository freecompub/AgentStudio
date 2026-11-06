// Converti en JavaScript le 2026-10-10 depuis extensions/skraft-workflow/src/review-thread.ts (ADR 0055).
/** Statuts qui demandent encore un travail de l'agent. */
const ACTIVE = ["open", "maintained", "humanMaintained"];
export const isActive = (t) => ACTIVE.includes(t.status);
const LIBELLE = { test: "test", code: "code", deliverable: "livrable" };
/**
* Cible effective d'un défaut. La lentille la déclare ; le fichier cité ne la corrige que dans UN
* sens : un défaut qui cite un fichier de test va au testeur, puisque le développeur ne peut pas y
* toucher. L'inverse est faux : un défaut « test manquant » cite naturellement le code qu'aucun test
* ne couvre. Le 03/10, la règle symétrique (« le fichier fait foi ») a envoyé un tel défaut au
* développeur, tests gelés ; il a fini par supprimer le code non testé pour satisfaire la revue.
*/
export function effectiveTarget(d, classify) {
  const declared = d.target ?? "code";
  const k = d.file ? classify(d.file) : null;
  if (k === "test" && declared !== "test")
    return { target: "test", note: `cible déclarée « ${declared} », fichier de ${LIBELLE[k]} : routé vers « test »` };
  return { target: declared };
}
/**
* Gravité maximale par lentille (4.4 de docs/15). Repris de skraft-plugin v1.6.1, cold-reader-lens :
* « Maximum severity for this lens is `medium`. Nothing here is a `blocker`. » La clarté ne bloque
* jamais seule une phase : un `blocker` devient `major` et un `REJECTED` un `CHANGES_REQUESTED`.
*/
const GRAVITE_MAX = { "cold-reader": "major" };
function plafonner(l) {
  const max = GRAVITE_MAX[l.lens];
  if (!max)
    return l;
  return {
    ...l,
    verdict: l.verdict === "REJECTED" ? "CHANGES_REQUESTED" : l.verdict,
    defects: l.defects.map((d) => (d.severity === "blocker" ? { ...d, severity: max, severityNote: `gravité déclarée « blocker », plafonnée à « ${max} » pour la lentille ${l.lens}` } : d)),
  };
}
/** Identifiants et cibles effectives, attribués par le code : un identifiant inventé par un modèle n'est pas stable. */
export function numberDefects(lenses, round, classify) {
  return lenses.map(plafonner).map((l) => ({
    ...l,
    defects: l.defects.map((d, i) => {
      const { target, note } = effectiveTarget(d, classify);
      return { ...d, id: `${l.lens}#${round}.${i + 1}`, target, ...(note ? { targetNote: note } : {}) };
    }),
  }));
}
const asDefect = (t) => ({
  severity: t.severity,
  description: t.description,
  target: t.target,
  id: t.id,
  ...(t.file ? { file: t.file } : {}),
  ...(t.line ? { line: t.line } : {}),
});
/**
* Un tour de revue : arbitrages appliqués aux contestations, nouveaux fils ouverts, et verdicts à
* synthétiser — où un défaut maintenu figure même si la lentille a omis de le relister, pour
* qu'une revue ne puisse pas approuver ce qu'elle vient de maintenir.
*/
export function reviewRound(prev, lenses, round) {
  const persistent = [];
  const carried = prev.map((t) => {
    const ruling = lenses.find((l) => l.lens === t.lens)?.rulings?.find((r) => r.defect === t.id);
    const why = ruling?.reason ? { ruling: ruling.reason } : {};
    if (t.status === "contested")
      return ruling?.decision === "accepted" ? { ...t, status: "accepted", ...why } : { ...t, status: "maintained", ruling: ruling?.reason ?? "aucun arbitrage rendu : le défaut est maintenu" };
    if (t.status === "recontested") {
      if (ruling?.decision === "accepted")
        return { ...t, status: "accepted", ...why };
      const p = { ...t, ...why };
      persistent.push(p);
      return p;
    }
    // Sans contestation, le tour précédent est clos : la lentille vient de rejuger le livrable et
    // aurait signalé de nouveau un défaut encore présent.
    if (isActive(t))
      return { ...t, status: "fixed" };
    return t;
  });
  const fresh = lenses.flatMap((l) => l.defects
    .filter((d) => d.severity !== "minor")
    .map((d, i) => ({
    id: d.id ?? `${l.lens}#${round}.${i + 1}`,
    lens: l.lens,
    severity: d.severity,
    description: d.description,
    ...(d.file ? { file: d.file } : {}),
    ...(d.line ? { line: d.line } : {}),
    ...(d.severityReason ? { severityReason: d.severityReason } : {}),
    ...(d.occurrences?.length ? { occurrences: d.occurrences } : {}),
    target: d.target ?? "code",
    status: "open",
    round,
  })));
  const pending = carried.filter((t) => t.status === "maintained" || persistent.includes(t));
  const forSynthesis = lenses.map((l) => {
    const extra = pending.filter((t) => t.lens === l.lens && !l.defects.some((d) => d.id === t.id)).map(asDefect);
    if (!extra.length)
      return l;
    return { ...l, verdict: l.verdict === "REJECTED" ? l.verdict : "CHANGES_REQUESTED", defects: [...l.defects, ...extra] };
  });
  return { threads: [...carried, ...fresh], persistent, lenses: forSynthesis };
}
/**
* Défauts mineurs d'une revue, en fils (D5 de `docs/12`). Une revue de DELIVER « changements
* demandés » qui ne relève que des mineurs n'a aucun fil actif : rejouer la phase, où tout est déjà
* vert, ne ferait travailler personne. Ses mineurs sont alors corrigés comme des majeurs.
*/
export function minorThreads(lenses, round) {
  return lenses.flatMap((l) => l.defects
    .filter((d) => d.severity === "minor")
    .map((d, i) => ({
    id: `${l.lens}#${round}.mineur${i + 1}`,
    lens: l.lens,
    severity: "minor",
    description: d.description,
    ...(d.file ? { file: d.file } : {}),
    ...(d.line ? { line: d.line } : {}),
    target: d.target ?? "code",
    status: "open",
    round,
  })));
}
/**
* Réponses de l'agent aux fils qui le concernent. Contester sans raison ne vaut rien.
*
* « Hors de mon périmètre » (ADR 0047) : le défaut est juste mais revient à l'autre agent.
* `reroute` dit lequel ; sans second agent (hors DELIVER), c'est une contestation. Un défaut ne se
* renvoie qu'une fois : renvoyé de nouveau, il devient une contestation que la lentille arbitrera,
* au lieu de rebondir sans fin entre les deux agents.
*/
export function applyResponses(threads, responses, concerns, reroute) {
  return threads.map((t) => {
    const r = responses.find((x) => x.defect === t.id);
    if (!r || !concerns(t) || !isActive(t))
      return t;
    if (r.status === "fixed")
      return { ...t, status: "fixed" };
    const reason = r.reason?.trim();
    if (!reason || t.status === "humanMaintained")
      return t;
    if (r.status === "outOfScope" && reroute && !t.rerouted)
      return { ...t, target: reroute(t), status: "open", rerouted: true, contestation: reason };
    return { ...t, status: t.status === "maintained" ? "recontested" : "contested", contestation: reason };
  });
}
/**
* Correction où l'agent ne modifie rien (D7 de docs/12) : permis seulement si **chaque** défaut actif
* qui le concerne reçoit une contestation ou un renvoi motivés. La lentille arbitrera ; sans cela,
* la règle « aucun fichier modifié » refuserait la contestation que sa consigne lui propose.
*/
export function allDisputed(threads, responses, concerns) {
  const miens = threads.filter((t) => isActive(t) && concerns(t));
  return miens.length > 0 && miens.every((t) => {
    const r = responses.find((x) => x.defect === t.id);
    return t.status !== "humanMaintained" && (r?.status === "contested" || r?.status === "outOfScope") && !!r.reason?.trim();
  });
}
/**
* Fin du tour d'un agent en correction : ses défauts encore actifs sont tenus pour traités. La revue
* suivante rejuge le livrable et signalera de nouveau ce qui persiste. Sans cela, un agent qui ne
* remplit pas `responses` laisse ses défauts actifs pour toujours, et la correction rebondit entre
* le testeur et le développeur sans fin (revue de code du 03/10).
*/
export function endTurn(threads, concerns) {
  return threads.map((t) => (isActive(t) && concerns(t) ? { ...t, status: "fixed" } : t));
}
/** Décision humaine sur un désaccord persistant : `accept:<id>` (raison à l'agent) ou `maintain:<id>` (à la lentille). */
export function applyArbitration(threads, decision) {
  const i = decision.indexOf(":");
  const action = decision.slice(0, i);
  const id = decision.slice(i + 1);
  if (action !== "accept" && action !== "maintain")
    return threads;
  return threads.map((t) => (t.id === id && t.status === "recontested" ? { ...t, status: action === "accept" ? "humanAccepted" : "humanMaintained" } : t));
}
/** Ce qu'on attend de l'agent face aux défauts qui lui sont transmis. */
export const RESPONSE_INSTRUCTION = "Réponds à chaque défaut ci-dessus dans le champ `responses` de report_phase : `fixed` si tu l'as corrigé, `contested` avec ta raison si tu estimes qu'il ne faut pas le corriger, `outOfScope` avec ta raison s'il est juste mais que sa correction n'est pas de ton ressort. Un défaut maintenu après contestation doit être corrigé ; le contester encore soumet le désaccord à l'humain.";
const where = (t) => (t.file ? ` (${t.file}${t.line ? `:${t.line}` : ""})` : "");
/** Retour à l'agent : les fils actifs qui le concernent, puis le rappel des demandes déjà corrigées. */
export function agentFeedback(threads, concerns) {
  const mine = threads.filter(concerns);
  const active = mine.filter(isActive);
  const lines = active.map((t) => {
    const head = `[${t.id}, ${t.severity}, ${t.target}] ${t.description}${where(t)}${precisions(t)}`;
    if (t.status === "maintained")
      return `${head} — maintenu par la lentille après ta contestation (${t.ruling ?? "sans raison donnée"}) : à corriger.`;
    if (t.status === "humanMaintained")
      return `${head} — tranché par l'humain en faveur de la lentille : à corriger, sans recours.`;
    return head;
  });
  const done = mine.filter((t) => t.status === "fixed");
  if (done.length)
    lines.push("Rappel des demandes des revues précédentes, déclarées corrigées : ne les défais pas.", ...done.map((t) => `  - [${t.id}] ${t.description}`));
  if (active.length)
    lines.push(RESPONSE_INSTRUCTION);
  return lines;
}
/** Ce qu'une lentille doit savoir de SES défauts précédents : réponse de l'agent, et ce qu'on attend d'elle. */
export function lensHistory(threads, lens) {
  const mine = threads.filter((t) => t.lens === lens && !["accepted", "humanAccepted"].includes(t.status));
  if (!mine.length)
    return [];
  return [
    "Tes défauts des revues précédentes, et la réponse de l'agent :",
    ...mine.map((t) => {
      const head = `  - [${t.id}] ${t.description}${where(t)}`;
      switch (t.status) {
        case "contested":
          return `${head} — contesté par l'agent : « ${t.contestation} ». Rends un arbitrage dans \`rulings\` (accepted si la raison te convainc, maintained sinon), avec ta raison.`;
        case "recontested":
          return `${head} — contesté une seconde fois : « ${t.contestation} ». Rends un arbitrage dans \`rulings\` ; si tu maintiens, l'humain tranchera.`;
        case "fixed":
          return `${head} — déclaré corrigé : vérifie ; s'il persiste, signale-le de nouveau.`;
        case "humanMaintained":
          return `${head} — maintenu par l'humain : vérifie qu'il est corrigé.`;
        default:
          return `${head} — sans réponse de l'agent : vérifie ; s'il persiste, signale-le de nouveau.`;
      }
    }),
  ];
}
/**
* Verdicts d'une revue relus à la lumière des fils, après un arbitrage humain : un défaut accepté
* disparaît, un défaut maintenu figure. Une lentille dont il ne reste aucun défaut blocker ou major
* après le retrait d'un défaut accepté compte comme approbatrice — elle n'avait réclamé que lui.
*/
export function lensesAfterThreads(lenses, threads) {
  const dropped = new Set(threads.filter((t) => t.status === "accepted" || t.status === "humanAccepted").map((t) => t.id));
  const pending = threads.filter((t) => ["maintained", "humanMaintained", "recontested"].includes(t.status));
  return lenses.map((l) => {
    const kept = l.defects.filter((d) => !d.id || !dropped.has(d.id));
    const extra = pending.filter((t) => t.lens === l.lens && !kept.some((d) => d.id === t.id)).map(asDefect);
    const defects = [...kept, ...extra];
    if (l.verdict === "REJECTED")
      return { ...l, defects };
    const serious = defects.some((d) => d.severity !== "minor");
    // Un défaut tombé peut ne figurer que dans les arbitrages de la lentille, pas dans ses défauts :
    // c'est le fil qui dit qu'elle n'avait plus que lui à réclamer.
    const removed = kept.length < l.defects.length || threads.some((t) => t.lens === l.lens && dropped.has(t.id));
    return { ...l, defects, verdict: serious ? "CHANGES_REQUESTED" : removed ? "APPROVED" : l.verdict };
  });
}
/** Gravités soumises au réfutateur : un mineur n'empêche pas l'approbation (ADR 0069). */
const A_REFUTER = ["blocker", "major"];
/**
* Défauts à soumettre au réfutateur (ADR 0069), par lentille : ses blocker et major. Une lentille
* REJECTED n'est pas soumise : son rejet escalade à l'humain de toute façon.
*/
export function defautsARefuter(lenses) {
  return lenses
    .filter((l) => l.verdict !== "REJECTED")
    .map((l) => ({ lens: l.lens, defects: l.defects.filter((d) => A_REFUTER.includes(d.severity)) }))
    .filter((x) => x.defects.length > 0);
}
/** Passages `chemin:ligne` cités dans une raison (guillemets inversés acceptés). */
const CITATION = /([\w./-]+\.[\w]+):(\d+)/g;
/**
* Arbitrages du réfutateur appliqués aux verdicts (ADR 0069). Le code décide de ce qui tombe : une
* réfutation (`accepted`) n'est retenue que si sa raison cite un passage `chemin:ligne` d'un fichier
* qui existe ; sinon, ou sans arbitrage, le défaut est maintenu. Les défauts réfutés restent dans
* `refuted`, avec la raison, pour le rapport. Une lentille CHANGES_REQUESTED à qui il ne reste ni
* blocker ni major n'avait réclamé qu'eux : elle approuve. `lens` borne les arbitrages à une lentille.
*/
export function appliquerRefutations(lenses, rulings, existe, lens) {
  const cite = (raison) => [...(raison ?? "").matchAll(CITATION)].some((m) => existe(m[1]));
  return lenses.map((l) => {
    if (l.verdict === "REJECTED" || (lens !== undefined && l.lens !== lens))
      return l;
    const tombe = (d) => A_REFUTER.includes(d.severity) && rulings.some((r) => r.defect === d.id && r.decision === "accepted" && cite(r.reason));
    const refutes = l.defects.filter(tombe).map((d) => ({ ...d, refutation: rulings.find((r) => r.defect === d.id).reason }));
    if (!refutes.length)
      return l;
    const defects = l.defects.filter((d) => !tombe(d));
    const serieux = defects.some((d) => A_REFUTER.includes(d.severity));
    return { ...l, defects, refuted: [...(l.refuted ?? []), ...refutes], verdict: l.verdict === "CHANGES_REQUESTED" && !serieux ? "APPROVED" : l.verdict };
  });
}

/** Raison de la gravité et autres endroits du même défaut, quand la lentille les donne. */
export const precisions = (d) => `${d.severityReason ? ` — gravité : ${d.severityReason}` : ""}${d.occurrences?.length ? ` — aussi : ${d.occurrences.join(", ")}` : ""}`;
/**
* Occurrences vérifiées par le code : un endroit qui vise un fichier absent du dépôt est retiré,
* et le retrait est noté. Un défaut ne doit pas renvoyer le producteur vers un fichier qui n'existe pas.
*/
export function verifierOccurrences(lenses, existe) {
  return lenses.map((l) => ({
    ...l,
    defects: l.defects.map((d) => {
      if (!d.occurrences?.length)
        return d;
      const absentes = d.occurrences.filter((o) => !existe(o.slice(0, o.lastIndexOf(":"))));
      if (!absentes.length)
        return d;
      const { occurrences: _, ...reste } = d;
      const gardees = d.occurrences.filter((o) => !absentes.includes(o));
      return { ...reste, ...(gardees.length ? { occurrences: gardees } : {}), occurrencesNote: `occurrence retirée, fichier introuvable : ${absentes.join(", ")}` };
    }),
  }));
}
