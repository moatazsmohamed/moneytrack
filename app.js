/**
 * Vercel entry point.
 *
 * Vercel's zero-configuration Express preset looks for an `app`, `index` or `server`
 * module at the project root (or under `src/`) that imports `express` and default-exports
 * the application. The framework import below is what the preset inspects, so it must
 * stay in this file even though the application itself is assembled in `server/index.js`.
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './server/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// On Vercel the traced bundle keeps the project layout, but the working directory is not
// guaranteed, so resolve the generated static build explicitly once.
if (!process.env.MONEYTRACK_DIST_ROOT) {
  const candidates = [
    path.join(here, 'dist'),
    path.join(process.cwd(), 'dist'),
    path.join(here, '..', 'dist'),
  ];
  const found = candidates.find((dir) => fs.existsSync(path.join(dir, 'index.html')));
  if (found) process.env.MONEYTRACK_DIST_ROOT = found;
}

if (typeof express !== 'function') throw new TypeError('The express framework is unavailable.');

const app = createApp();

export default app;
