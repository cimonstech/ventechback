import fs from 'fs';
import path from 'path';

try {
  // Optional: load .env when present so Playwright/logo fetches can use local config.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch {
  // ignore
}

import { renderAllSamples } from '../src/emails/samples';

const OUT_DIR = 'C:\\ventech\\audits\\emails';
const SCREEN_DIR = path.join(OUT_DIR, 'screens');

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function screenshots(files: Array<{ id: string; file: string }>) {
  let playwright: typeof import('playwright');
  try {
    playwright = require('playwright');
  } catch {
    console.warn('Playwright is not installed. HTML previews were written; screenshots were skipped.');
    return;
  }
  ensureDir(SCREEN_DIR);
  const browser = await playwright.chromium.launch();
  try {
    for (const item of files) {
      for (const width of [600, 375] as const) {
        const page = await browser.newPage({
          viewport: { width, height: 900 },
          colorScheme: 'light',
        });
        await page.goto(`file://${item.file.replace(/\\/g, '/')}`, { waitUntil: 'load' });
        const height = await page.evaluate(() => Math.max(document.body.scrollHeight, 900));
        await page.setViewportSize({ width, height: Math.min(height, 4000) });
        const shot = path.join(SCREEN_DIR, `${item.id}-${width}.png`);
        await page.screenshot({ path: shot, fullPage: true });
        await page.close();
        console.log(`screenshot ${shot}`);
      }
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  ensureDir(OUT_DIR);
  ensureDir(SCREEN_DIR);
  const samples = renderAllSamples();
  const used = new Set<string>();
  const files: Array<{ id: string; file: string; subject: string }> = [];

  for (const email of samples) {
    let id = email.id;
    if (used.has(id)) {
      let n = 2;
      while (used.has(`${id}-${n}`)) n += 1;
      id = `${id}-${n}`;
    }
    used.add(id);
    const file = path.join(OUT_DIR, `${id}.html`);
    fs.writeFileSync(file, email.html, { encoding: 'utf8' });
    files.push({ id, file, subject: email.subject });
    console.log(`wrote ${file}`);
  }

  const index = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>VENTECH email previews</title>
  <style>
    body { font-family: -apple-system, Segoe UI, sans-serif; background: #F5F5F4; color: #1A1A1A; margin: 24px; }
    a { color: #C2410C; }
    li { margin: 8px 0; }
  </style>
</head>
<body>
  <h1>VENTECH email previews</h1>
  <p>${files.length} templates. Open a file, or see screens/ for 600px and 375px captures.</p>
  <ol>
    ${files.map((item) => `<li><a href="${escapeHtml(path.basename(item.file))}">${escapeHtml(item.id)}</a> — ${escapeHtml(item.subject)}</li>`).join('\n    ')}
  </ol>
</body>
</html>`;
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), index, { encoding: 'utf8' });
  await screenshots(files);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
