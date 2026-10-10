import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ResumeComparable } from "./etapes.js";

/**
 * Rapport de comparaison extension skraft / workflow skraft (`docs/10` §7, P6).
 *
 * `comparer` est pur : il met en forme les `resume.json` des runs, il ne mesure rien. Le reste du
 * fichier est la commande, qui lit les dossiers de runs et écrit le rapport :
 *
 *   tsx scripts/banc/comparer.ts [--story=us-2] [--prix=<€ par requête>] <dossier de run>…
 */

export interface Run {
  /** Dossier du run, sous `docs/runs/`. */
  nom: string;
  mode: string;
  livre: boolean;
  arret: string | null;
  comparable: ResumeComparable;
}

export interface Options {
  date: string;
  story: string;
  /** Prix d'une requête premium, en euros ; absent, la colonne n'est pas calculée (`docs/10` §4.2). */
  prix?: number;
}

/** Différences assumées entre les deux (`docs/10` §2, ADR 0054) : le lecteur y rapporte les écarts. */
const ASSUMEES = [
  "le workflow fait oublier aux agents leur session après un rembobinage (ADR 0053) ; l'extension ne le faisait pas en DELIVER ;",
  "plusieurs amendements d'ADR sont traités ensemble dans le workflow ;",
  "« relancer » après une escalade pendant une correction de revue reprend la correction.",
];

/**
 * Famille d'une porte, pour mettre les rejets en regard : les deux implémentations nomment
 * parfois la même porte différemment (`DELIVER : mutation` / `mutation`, `pas test (s1)` /
 * `DELIVER`), ou la qualifient d'un identifiant de scénario.
 */
export function famille(porte: string): string {
  const p = porte.replace(/^DELIVER : /, "").trim();
  if (p === "DELIVER" || /^pas /.test(p)) return "pas";
  if (p === "phase") return "DELIVER";
  if (/^scénario /.test(p)) return "scénario";
  return p.replace(/\s*\([^)]*\)$/, "");
}

const requetes = (nanoAiu: number) => Math.round((nanoAiu / 1e9) * 10) / 10;
const hms = (ms: number) => {
  const sec = Math.round(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = `${Math.floor((sec % 3600) / 60)}m${String(sec % 60).padStart(2, "0")}`;
  return h ? `${h}h${m.padStart(5, "0")}` : m;
};
export function mediane(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const t = [...xs].sort((a, b) => a - b);
  const m = Math.floor(t.length / 2);
  return t.length % 2 ? t[m]! : (t[m - 1]! + t[m]!) / 2;
}
const cellule = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function comparer(runs: readonly Run[], o: Options): string {
  const modes = [...new Set(runs.map((r) => r.mode))];
  const de = (mode: string) => runs.filter((r) => r.mode === mode);
  const valeur = (fmt: (n: number) => string | number, f: (r: Run) => number) => (rs: readonly Run[]) =>
    `${fmt(mediane(rs.map(f)))} (${rs.map((r) => fmt(f(r))).join(", ")})`;
  const synthese: [string, (rs: readonly Run[]) => string][] = [
    ["Livré", (rs) => `${rs.filter((r) => r.livre).length}/${rs.length}${rs.some((r) => r.arret) ? ` — arrêts : ${rs.filter((r) => r.arret).map((r) => r.arret).join(" ; ")}` : ""}`],
    ["Durée hors attente humaine", valeur(hms, (r) => r.comparable.total.horsAttenteMs)],
    ["Attente humaine", valeur(hms, (r) => r.comparable.total.attenteHumaineMs)],
    ["Requêtes premium", valeur(requetes, (r) => r.comparable.total.nanoAiu)],
    ...(o.prix !== undefined ? [["Coût (€)", valeur((n) => (Math.round(n * 100) / 100).toFixed(2), (r) => requetes(r.comparable.total.nanoAiu) * o.prix!)] as [string, (rs: readonly Run[]) => string]] : []),
    ["Tokens d'entrée", valeur(String, (r) => r.comparable.total.entrée)],
    ["Tokens de sortie", valeur(String, (r) => r.comparable.total.sortie)],
    ["Rejeux", valeur(String, (r) => r.comparable.total.rejets)],
    ["Interventions humaines", valeur(String, (r) => r.comparable.total.interventions)],
  ];

  const familles = [...new Set(runs.flatMap((r) => r.comparable.rejeux.map((x) => famille(x.porte))))].sort();
  const compte = (r: Run, f: string) => r.comparable.rejeux.filter((x) => famille(x.porte) === f).length;

  return [
    `# Comparaison extension / workflow skraft — ${o.story} — ${o.date}`,
    "",
    `Produit par \`scripts/banc/comparer.ts\` (\`docs/10\` §7) depuis ${runs.length} run(s) : ${runs.map((r) => `\`${r.nom}\``).join(", ")}.`,
    "Les valeurs sont la médiane des runs, suivie des valeurs brutes entre parenthèses.",
    "",
    "## 1. Synthèse",
    "",
    `| Mesure | ${modes.join(" | ")} |`,
    `|---|${modes.map(() => "---").join("|")}|`,
    ...synthese.map(([titre, f]) => `| ${titre} | ${modes.map((m) => cellule(f(de(m)))).join(" | ")} |`),
    "",
    "## 2. Par étape",
    "",
    "| Run | Étape | Sous-étapes | Durée | Agents | Code | Moteur | Attente humaine | Tours | Appels | Requêtes premium | Tokens entrée | Tokens sortie | Rejeux |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...runs.flatMap((r) =>
      r.comparable.etapes.map(
        (l) =>
          `| ${r.mode} · ${r.nom} | ${l.etape} | ${l.sousEtapes.join(", ")} | ${hms(l.duréeMs)} | ${hms(l.agentsMs)} | ${hms(l.codeMs)} | ${hms(l.moteurMs)} | ${hms(l.attenteHumaineMs)} | ${l.tours} | ${l.appels} | ${requetes(l.nanoAiu)} | ${l.entrée} | ${l.sortie} | ${l.rejets} |`,
      ),
    ),
    "",
    "## 3. Rejeux, run par run",
    "",
    ...runs.flatMap((r) => [
      `### ${r.mode} · ${r.nom}`,
      "",
      ...(r.comparable.rejeux.length
        ? r.comparable.rejeux.flatMap((x, i) => [
            `${i + 1}. **${x.etape}${x.sousEtape ? ` · ${x.sousEtape}` : ""}**, essai ${x.essai}, ${x.nature}, porte « ${x.porte} »`,
            ...x.motifs.map((m) => `   - ${m.replace(/\n/g, "\n     ")}`),
          ])
        : ["Aucun rejeu."]),
      "",
    ]),
    "## 4. Rejeux mis en regard, par porte",
    "",
    "Un rejet présent d'un seul côté doit être expliqué (différence connue ou hasard du modèle) : aucun écart sans explication.",
    "",
    `| Porte | ${modes.join(" | ")} | Explication |`,
    `|---|${modes.map(() => "---").join("|")}|---|`,
    ...familles.map((f) => {
      const parMode = modes.map((m) => de(m).map((r) => compte(r, f)));
      const unCote = parMode.filter((xs) => xs.some((n) => n > 0)).length < modes.length;
      return `| ${f} | ${parMode.map((xs) => `${xs.reduce((a, b) => a + b, 0)} (${xs.join(", ")})`).join(" | ")} | ${unCote ? "**à expliquer**" : ""} |`;
    }),
    ...(familles.length ? [] : ["| — | " + modes.map(() => "0").join(" | ") + " | |"]),
    "",
    "## 5. Écarts de comportement",
    "",
    "Différences assumées (`docs/10` §2), à confronter aux écarts observés ci-dessus :",
    "",
    ...ASSUMEES.map((a) => `- ${a}`),
    "",
    "Écarts observés : _à compléter à la lecture des runs._",
    "",
  ].join("\n");
}

async function principal(args: string[]): Promise<void> {
  const opt = (nom: string) => args.find((a) => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);
  const dossiers = args.filter((a) => !a.startsWith("--"));
  if (!dossiers.length) throw new Error("Utilisation : tsx scripts/banc/comparer.ts [--story=us-2] [--prix=0.04] <dossier de run>…");
  const runs: Run[] = [];
  for (const d of dossiers) {
    const j = JSON.parse(await readFile(join(d, "resume.json"), "utf8")) as Partial<Run>;
    if (!j.comparable || typeof j.livre !== "boolean") throw new Error(`${d} : resume.json sans résumé comparable — run antérieur au banc (docs/10 P3).`);
    runs.push({ nom: d.replace(/\/$/, "").split("/").at(-1)!, mode: j.mode ?? "?", livre: j.livre, arret: j.arret ?? null, comparable: j.comparable });
  }
  const story = opt("story") ?? "us-2";
  const prix = opt("prix");
  const date = new Date().toISOString().slice(0, 10);
  const sortie = join("docs/runs", `${date}-comparaison-${story}.md`);
  await writeFile(sortie, comparer(runs, { date, story, ...(prix ? { prix: Number(prix) } : {}) }));
  console.log(`Rapport : ${sortie}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await principal(process.argv.slice(2));
