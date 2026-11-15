/** One curated naming snapshot shared with the catalog service. No network needed. */
import snapshot from "../../../services/catalogs/fixtures/catalogs/presets.json" with { type: "json" };
import type { ObjectIdentity, ResolveResult } from "../inspector/types";

export const namingVersion = snapshot.version;
export const namedTargets: ResolveResult[] = snapshot.presets.map(({ name, ra, dec, identity, positionProvenance }) => ({ name, ra, dec, identity, positionProvenance }));

export function normalizeName(name: string): string {
  return name.normalize("NFKC").replace(/[’‘]/g, "'").replace(/[−–—]/g, "-")
    .trim().toLowerCase().replace(/\s+/g, " ").replace(/^ε(?=\s|$)/u, "epsilon")
    .replace(/^(gj|hip)(?=\d)/, "$1 ");
}

export function nameIssue(name: string): { code: string; message: string } | null {
  if (!name.trim() || name.length > 256 || /[\u0000-\u001f]/.test(name)) {
    return { code: "invalid_request", message: "Enter a name of 1–256 characters without control characters." };
  }
  const key = normalizeName(name);
  if (/^(epsilon|eps) ind(i)?( b)?$/.test(key) && !(key.endsWith(" b") && name.trim().endsWith("B"))) {
    return { code: "ambiguous_name", message: "Choose Epsilon Indi B (the Ba/Bb brown-dwarf pair), or enter an explicit component designation. A, Ba, Bb and planet designations are distinct." };
  }
  return null;
}

function terms(target: ResolveResult): string[] {
  const identity = target.identity!;
  return [...new Set([target.name, identity.displayName, identity.canonicalDesignation, ...identity.aliases])];
}

export function localTarget(name: string): ResolveResult | null {
  if (nameIssue(name)) return null;
  return namedTargets.find(target => terms(target).some(term => normalizeName(term) === normalizeName(name))) ?? null;
}

export function targetSuggestions(query: string): { target: ResolveResult; matchedAlias: string }[] {
  const key = normalizeName(query);
  if (key.length < 2) return [];
  return namedTargets.map(target => {
    const matches = terms(target).map(term => {
      const normalized = normalizeName(term);
      const rank = normalized === key ? (term === target.identity!.displayName ? 0 : 1)
        : normalized.split(" ").some(word => word.startsWith(key)) || normalized.startsWith(key) ? 2
        : normalized.includes(key) ? 3 : 99;
      return { term, rank };
    }).sort((a, b) => a.rank - b.rank);
    return { target, matchedAlias: matches[0].term, rank: matches[0].rank };
  }).filter(match => match.rank < 99).sort((a, b) => a.rank - b.rank).slice(0, 5);
}

/** A partial query needs an explicit choice, even with only one local candidate. */
export function partialNameIssue(name: string): { code: string; message: string } | null {
  if (localTarget(name)) return null;
  const matches = targetSuggestions(name);
  return matches.length ? {
    code: "incomplete_name",
    message: `Choose a matching target: ${matches.map(item => item.target.identity!.displayName).join(", ")}. Or enter a full name or catalog identifier.`,
  } : null;
}

/** Validate enrichment from the wire before treating it as an identity. */
export function validIdentity(value: unknown): value is ObjectIdentity {
  if (!value || typeof value !== "object") return false;
  const record = value as ObjectIdentity;
  return typeof record.objectId === "string" && !!record.objectId &&
    (record.commonName === null || typeof record.commonName === "string") &&
    typeof record.displayName === "string" && !!record.displayName &&
    typeof record.canonicalDesignation === "string" && !!record.canonicalDesignation &&
    typeof record.component === "string" && Array.isArray(record.aliases) && record.aliases.every(x => typeof x === "string") &&
    Array.isArray(record.relatedDesignations) && record.relatedDesignations.every(x => typeof x === "string") &&
    Array.isArray(record.catalogIds) && record.catalogIds.every(x => x && typeof x.catalog === "string" && typeof x.id === "string") &&
    Array.isArray(record.provenance) && record.provenance.length > 0 && record.provenance.every(x => x &&
      typeof x.source === "string" && typeof x.url === "string" && /^https:\/\//.test(x.url) &&
      typeof x.kind === "string" && typeof x.retrievedAtUtc === "string" && Number.isFinite(Date.parse(x.retrievedAtUtc)));
}
