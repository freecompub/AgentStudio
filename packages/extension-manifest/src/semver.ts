/** Semver minimal (x.y.z) : `^`, `~`, `>=` et version exacte ; suffisant pour `engines.appApi` (D13). */
export type Version = [number, number, number];

export function parseVersion(v: string): Version | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function parsePartial(v: string): Version | null {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}

const cmp = (a: Version, b: Version) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  const r = range.trim();
  if (!v) return false;
  if (r.startsWith(">=")) {
    const min = parsePartial(r.slice(2));
    return !!min && cmp(v, min) >= 0;
  }
  if (r.startsWith("^")) {
    const min = parsePartial(r.slice(1));
    if (!min) return false;
    // ^0.y : même mineure (API instable avant 1.0) ; ^x : même majeure.
    const sameLine = min[0] === 0 ? v[0] === 0 && v[1] === min[1] : v[0] === min[0];
    return sameLine && cmp(v, min) >= 0;
  }
  if (r.startsWith("~")) {
    const min = parsePartial(r.slice(1));
    return !!min && v[0] === min[0] && v[1] === min[1] && cmp(v, min) >= 0;
  }
  const exact = parseVersion(r);
  return !!exact && cmp(v, exact) === 0;
}
