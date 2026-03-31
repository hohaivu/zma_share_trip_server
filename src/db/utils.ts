// Helper functions to safely convert pg results to TS domains.

export function normalizeUtc(val: string | Date | null | undefined): string | undefined {
  if (!val) return undefined;
  return new Date(val).toISOString();
}

export function parseJsonb<T>(val: unknown): T | null {
  if (!val) return null;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val) as T;
    } catch {
      return null;
    }
  }
  return val as T;
}

export function parseNumeric(val: unknown): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  const parsed = parseFloat(String(val));
  return isNaN(parsed) ? 0 : parsed;
}

export function toCamelCaseRecord(row: Record<string, unknown>): Record<string, unknown> {
  const res: Record<string, unknown> = {};
  for (const key in row) {
    let val = row[key];
    if (val instanceof Date) {
      val = val.toISOString();
    }
    const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
    res[camelKey] = val;
  }
  return res;
}

// Convert column mappings recursively if necessary, but returning generic Record
export function toCamelCase<T>(row: Record<string, unknown> | null | undefined): T | null {
  if (!row) return null;
  return toCamelCaseRecord(row) as unknown as T;
}
