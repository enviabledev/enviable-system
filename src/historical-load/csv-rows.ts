import { parse } from 'csv-parse/sync';

export interface ParseResult {
  records: Record<string, string>[];
  error?: string;
}

/**
 * Parse a CSV buffer with the first row as headers, validating that every
 * required header is present. Returns a header-level error rather than throwing.
 */
export function parseCsv(buffer: Buffer, requiredHeaders: string[]): ParseResult {
  let records: Record<string, string>[];
  try {
    records = parse(buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    }) as Record<string, string>[];
  } catch (e) {
    return { records: [], error: `CSV parse error: ${(e as Error).message}` };
  }
  if (records.length === 0) {
    return { records: [], error: 'CSV contains no data rows' };
  }
  const headers = Object.keys(records[0]);
  const missing = requiredHeaders.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    return {
      records: [],
      error: `Missing required header(s): ${missing.join(', ')}`,
    };
  }
  return { records };
}

/** Header is row 1, so the first data record (index 0) is file row 2. */
export function csvRowNumber(index: number): number {
  return index + 2;
}

export interface RowError {
  row: number;
  message: string;
}

/** Detect engine/chassis duplicates WITHIN the file, naming the value and rows. */
export function detectInFileUnitDuplicates(
  rows: { engineNumber: string; chassisNumber: string }[],
): RowError[] {
  const errors: RowError[] = [];
  const engineSeen = new Map<string, number>();
  const chassisSeen = new Map<string, number>();
  rows.forEach((r, i) => {
    const row = csvRowNumber(i);
    const e = engineSeen.get(r.engineNumber);
    if (r.engineNumber && e) {
      errors.push({
        row,
        message: `Duplicate engineNumber in file: ${r.engineNumber} (first seen row ${e})`,
      });
    } else if (r.engineNumber) {
      engineSeen.set(r.engineNumber, row);
    }
    const c = chassisSeen.get(r.chassisNumber);
    if (r.chassisNumber && c) {
      errors.push({
        row,
        message: `Duplicate chassisNumber in file: ${r.chassisNumber} (first seen row ${c})`,
      });
    } else if (r.chassisNumber) {
      chassisSeen.set(r.chassisNumber, row);
    }
  });
  return errors;
}
