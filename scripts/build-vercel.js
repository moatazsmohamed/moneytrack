import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'vercel-public');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
// Every Vercel request is proxied to the deployed Node server; no protected HTML is served statically.
fs.writeFileSync(path.join(output, 'index.html'), '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>MoneyTrack</title></head><body><h1>MoneyTrack</h1><p>جارٍ الاتصال بالخدمة. أعد المحاولة لاحقاً إذا كانت غير متاحة.</p></body></html>\n');
console.log('Built secure Vercel proxy output; no private pages, scripts or secrets copied.');
