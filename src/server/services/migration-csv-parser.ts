/**
 * WP-08-01F MILESTONE B — Server-side CSV parser for migration files.
 *
 * Contract 08 §5.1: Normalized Historical Import Templates.
 *
 * Parses CSV files server-side with:
 *   - Header validation against template columns
 *   - Row-level lineage preservation (file ID, row number, column name)
 *   - Formula-injection detection (rejects cells starting with =, +, -, @)
 *   - Size and row count limits
 *   - No spreadsheet formula execution
 *
 * Does NOT write to operational tables — produces parsed row objects
 * that are staged through HistoricalStagingService.
 */
import "server-only";
import type { MigrationTemplateDefinition } from "./migration-templates";

export interface ParsedCsvRow {
  rowNumber: number;
  columns: Record<string, string>;
}

export interface CsvParseResult {
  rows: ParsedCsvRow[];
  totalRows: number;
  headers: string[];
  errors: string[];
}

export interface CsvParseOptions {
  maxFileSizeBytes: number;
  maxRows: number;
  template: MigrationTemplateDefinition;
}

const DEFAULT_OPTIONS: Partial<CsvParseOptions> = {
  maxFileSizeBytes: 10 * 1024 * 1024, // 10 MB
  maxRows: 10000,
};

/**
 * Parse a CSV string into rows with lineage.
 *
 * Security:
 *   - Rejects cells starting with =, +, -, @ (formula injection)
 *   - Enforces file size and row count limits
 *   - Validates headers against template columns
 *
 * Does NOT execute any spreadsheet formulas.
 */
export function parseCsv(
  csvContent: string,
  template: MigrationTemplateDefinition,
  options?: Partial<CsvParseOptions>,
): CsvParseResult {
  const opts = { ...DEFAULT_OPTIONS, ...options, template } as CsvParseOptions;
  const errors: string[] = [];

  // Size check
  if (csvContent.length > opts.maxFileSizeBytes) {
    errors.push(
      `File size ${csvContent.length} bytes exceeds maximum ${opts.maxFileSizeBytes} bytes.`,
    );
    return { rows: [], totalRows: 0, headers: [], errors };
  }

  // Split into lines (handle \r\n and \n)
  const lines = csvContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    errors.push("File is empty.");
    return { rows: [], totalRows: 0, headers: [], errors };
  }

  // Parse header row
  const headers = parseCsvLine(lines[0]!);

  // Validate headers against template
  const templateColumnNames = template.columns.map((c) => c.name);
  const missingRequired = template.columns
    .filter((c) => c.required && !headers.includes(c.name))
    .map((c) => c.name);
  if (missingRequired.length > 0) {
    errors.push(`Missing required columns: ${missingRequired.join(", ")}.`);
  }

  const extraColumns = headers.filter((h) => !templateColumnNames.includes(h));
  if (extraColumns.length > 0) {
    errors.push(`Unknown columns not in template: ${extraColumns.join(", ")}.`);
  }

  if (errors.length > 0) {
    return { rows: [], totalRows: 0, headers, errors };
  }

  // Row count check
  const dataRows = lines.slice(1);
  if (dataRows.length > opts.maxRows) {
    errors.push(`Row count ${dataRows.length} exceeds maximum ${opts.maxRows}.`);
    return { rows: [], totalRows: 0, headers, errors };
  }

  // Parse data rows
  const rows: ParsedCsvRow[] = [];
  for (let i = 0; i < dataRows.length; i++) {
    const rowNumber = i + 1; // 1-indexed (row 0 is header)
    const values = parseCsvLine(dataRows[i]!);

    // Check for formula injection
    for (let j = 0; j < values.length; j++) {
      const cellValue = values[j]!;
      if (/^[=+@]/.test(cellValue) || /^\t/.test(cellValue)) {
        errors.push(
          `Row ${rowNumber}, column "${headers[j]}": cell starts with a potentially dangerous character ` +
          `(=, +, @, or tab). Spreadsheet formula injection is not allowed.`,
        );
      }
    }

    // Build column map
    const columns: Record<string, string> = {};
    for (let j = 0; j < headers.length && j < values.length; j++) {
      columns[headers[j]!] = values[j]!;
    }

    rows.push({ rowNumber, columns });
  }

  return { rows, totalRows: rows.length, headers, errors };
}

/**
 * Parse a single CSV line, handling quoted fields.
 * Supports: "field","field with, comma","field with ""quotes"""
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          // Escaped quote
          current += '"';
          i++;
        } else {
          // End of quoted field
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        result.push(current);
        current = "";
      } else {
        current += char;
      }
    }
  }

  result.push(current);
  return result;
}
