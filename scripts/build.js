import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dictionaryPath = path.join(root, 'js/translations.js');
const marker = '// Generated workspace strings — edit js/workspace-strings.json, then run merge_strings.py.';
let base = fs.readFileSync(dictionaryPath, 'utf8').split(marker)[0].trimEnd() + '\n';
const merged = {};
for (const name of ['finance-strings.json','workspace-strings.json','extra-strings.json','station2-strings.json','phase4-strings.json','cloud-strings.json']) {
  const source = path.join(root, 'js', name);
  if (!fs.existsSync(source)) continue;
  const entries = JSON.parse(fs.readFileSync(source, 'utf8'));
  for (const [key, value] of Object.entries(entries)) {
    if (typeof value.en !== 'string' || typeof value.ar !== 'string') throw new Error(`Bilingual translation missing: ${key}`);
    merged[key] = value;
  }
}
base += `\n${marker}\n`;
for (const locale of ['en','ar']) {
  base += `Object.assign(translations.${locale}, ${JSON.stringify(Object.fromEntries(Object.entries(merged).map(([key,value]) => [key,value[locale]])), null, 2)});\n`;
}
fs.writeFileSync(dictionaryPath, base);

const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
for (const directory of ['css','js','assets']) fs.cpSync(path.join(root, directory), path.join(dist, directory), { recursive: true });
for (const name of ['index.html','app.html','manus-routes.json']) fs.copyFileSync(path.join(root,name), path.join(dist,name));
// Clean URLs (/login, /admin…) are routed by server/index.js; protected pages never get a directory index.
for (const name of ['login','register','forgot-password','reset-password','verify-email','resend-verification','privacy','terms','contact','admin']) {
  fs.copyFileSync(path.join(root,'public',`${name}.html`), path.join(dist,`${name}.html`));
}
fs.mkdirSync(path.join(dist,'en'), {recursive:true});
fs.copyFileSync(path.join(root,'public/en/index.html'), path.join(dist,'en/index.html'));
fs.writeFileSync(path.join(dist,'robots.txt'), 'User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /admin\nDisallow: /api/\nDisallow: /reset-password\nDisallow: /verify-email\n');
console.log(`Built MoneyTrack 2.0.0: ${Object.keys(merged).length} bilingual keys; static output excludes secrets and backend files.`);
