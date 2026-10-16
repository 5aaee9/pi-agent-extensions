/**
 * The threshold grammar this page accepts and the way it renders counts.
 *
 * `parseLimit` mirrors the grammar the Host `/autocompact` command accepts, so a
 * value typed here is always a value the command would take; `formatTokens`
 * writes counts back in those same `k`/`m` units.
 *
 * @module @indexyz/dsh-autocompact/client/limits
 */

/** Decimal unit suffixes the threshold grammar accepts. */
const UNITS: Record<string, number> = { k: 1_000, m: 1_000_000 };

/** Parse the same `300k` / `0.3m` / `300000` grammar the Host command accepts. */
export function parseLimit(input: unknown): number | undefined {
  const match = /^(\d+(?:\.\d+)?)([km]?)$/i.exec(String(input).trim());
  if (match === null) return undefined;
  const limit = Number(match[1]) * (UNITS[match[2].toLowerCase()] ?? 1);
  return Number.isSafeInteger(limit) && limit > 0 ? limit : undefined;
}

/**
 * One decimal place, without the trailing `.0`.
 *
 * Whole numbers from 100 up: nothing is gained by `1.2K` where `1200` is meant.
 */
function scaled(candidate: number): string {
  return candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10);
}

/**
 * Render one token count the way this deployment writes counts.
 *
 * This mirrors the formatter the composer's own readings use (`{value}K` /
 * `{value}M`, whole numbers from 100 up), so a threshold sits in that row as if
 * the host had written it, and a count reads back in the units the grammar takes.
 */
export function formatTokens(value: number): string {
  if (!Number.isSafeInteger(value)) return String(value);
  if (value < 1_000) return String(value);
  // The rounded reading picks the unit: 999,999 reads as `1M`, never `1000K`.
  return value >= 999_950 ? `${scaled(value / 1_000_000)}M` : `${scaled(value / 1_000)}K`;
}

/** Message of an unknown thrown value. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
