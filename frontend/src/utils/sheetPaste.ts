const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

export function isLikelyDomain(value: string): boolean {
  return DOMAIN_RE.test(value.trim());
}

export type SheetPasteRow = {
  key: number;
  domains: string[];
  target: string;
  valid: boolean;
};

/** Tokenizes a blob pasted straight from Google Sheets: tab-separated
 * columns, rows separated by newlines, RFC4180-style quoting so a cell can
 * contain literal newlines - Sheets does this when a cell holds several
 * domains stacked via Alt+Enter (a group that all shares one target in the
 * next column). Each newline inside a quoted source cell becomes its own
 * domain mapped to that row's target column. */
export function parseSheetPasteRows(text: string): SheetPasteRow[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"' && field === '') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === '\t') {
      pushField();
      i += 1;
      continue;
    }
    if (c === '\r') {
      i += 1;
      continue;
    }
    if (c === '\n') {
      pushRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field !== '' || row.length) pushRow();

  return rows
    .map((r, idx) => {
      const colA = (r[0] || '').trim();
      const colB = (r[1] || '').trim();
      const domains = colA
        ? colA
            .split(/\r?\n/)
            .map((d) => d.trim().toLowerCase())
            .filter(Boolean)
        : [];
      const valid = domains.length > 0 && !!colB && domains.every(isLikelyDomain);
      return { key: idx, domains, target: colB, valid };
    })
    .filter((r) => r.domains.length > 0 || r.target);
}

export function flattenSheetPasteRows(rows: SheetPasteRow[]): { domain: string; target: string }[] {
  return rows
    .filter((r) => r.valid)
    .flatMap((r) => r.domains.map((domain) => ({ domain, target: r.target })));
}
