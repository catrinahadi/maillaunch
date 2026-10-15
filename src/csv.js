export function parseCsv(input) {
  const text = String(input).replace(/^\uFEFF/, ''); // strip a utf-8 bom before parsing the file
  const rows = []; let row = [], field = '', quoted = false; // keep track of csv state while reading each character
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field.length === 0) quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field');
  if (field.length || row.length) { row.push(field); if (row.some(v => v.trim() !== '')) rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map(h => h.trim());
  if (headers.some(h => !h)) throw new Error('CSV headers must not be empty'); // fail fast on malformed column names
  return rows.map((values, index) => {
    const obj = {}; headers.forEach((h, i) => { obj[h] = (values[i] ?? '').trim(); }); // keep each row as an object keyed by header name
    Object.defineProperty(obj, '__rowNumber', { value: index + 2, enumerable: false }); return obj; // preserve original row number for debugging
  });
}
export function detectEmailColumn(headers) {
  return headers.find(h => /email|mail/i.test(h)) || null; // find the column that holds recipient addresses
}
export function validateRecipients(rows) {
  if (!rows.length) throw new Error('CSV has no recipient rows'); // reject empty csv input early
  const column = detectEmailColumn(Object.keys(rows[0]));
  if (!column) throw new Error('Could not detect an email column. Use a header containing "email" or "mail".'); // enforce the expected recipient field
  const isValidAddress = row => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(row[column] || ''));
  const valid = rows.filter(isValidAddress); // keep only addresses that look valid
  const skippedRows = rows.filter(row => !isValidAddress(row));
  return { rows: valid, emailColumn: column, skipped: skippedRows.length, skippedRows }; // return valid rows and the rows to report as skipped
}
