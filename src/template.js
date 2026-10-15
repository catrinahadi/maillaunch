export function renderTemplate(template, data) {
  // only replace simple identifier keys; nested/malformed braces remain unchanged.
  return String(template).replace(/(?<!\{)\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}(?!\})/g, (whole, key) => {
    const value = data?.[key]; return value === undefined || value === null ? whole : String(value); // keep placeholders visible when data is missing
  });
}
export function encodeSubject(subject) {
  const value = String(subject);
  if (/^[\x00-\x7F]*$/.test(value)) return value; // ascii subjects can be sent as plain text
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`; // encode utf-8 subjects for email compatibility
}
