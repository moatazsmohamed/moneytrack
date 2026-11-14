/** Split trusted schema files into individual statements without splitting quoted semicolons. */
export function splitSqlStatements(sql) {
  const out = []; let text = ''; let quote = null; let comment = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]; const next = sql[i + 1];
    if (comment === 'line') { if (ch === '\n') { comment = null; text += '\n'; } continue; }
    if (comment === 'block') { if (ch === '*' && next === '/') { comment = null; i++; text += ' '; } continue; }
    if (quote) {
      text += ch;
      if (ch === '\\') { if (next !== undefined) text += sql[++i]; }
      else if (ch === quote && next === quote) text += sql[++i];
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '-' && next === '-' && /\s/.test(sql[i + 2] || ' ')) { comment = 'line'; i++; continue; }
    if (ch === '#') { comment = 'line'; continue; }
    if (ch === '/' && next === '*') { comment = 'block'; i++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; text += ch; continue; }
    if (ch === ';') { if (text.trim()) out.push(text.trim()); text = ''; }
    else text += ch;
  }
  if (quote || comment === 'block') throw new SyntaxError('Unterminated SQL string or comment');
  if (text.trim()) out.push(text.trim());
  // These migrations contain DDL, not stored routines with custom delimiters.
  if (out.some(statement => /^DELIMITER\b/i.test(statement))) throw new SyntaxError('Custom SQL delimiters are not supported');
  return out;
}
