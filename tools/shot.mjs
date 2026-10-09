#!/usr/bin/env node
/**
 * Screenshot a page once it signals readiness (window.__ready === true).
 *
 *   node tools/shot.mjs "<url>" out.png [--w 1280] [--h 720] [--device "Pixel 7"] [--dpr 1]
 *                       [--timeout 30000] [--delay 0] [--stats]
 *
 * Relative URLs resolve against http://127.0.0.1:5190. Console errors are printed.
 */
import { chromium, devices } from '@playwright/test';

const args = process.argv.slice(2);
const positional = [];
const opts = {};
for (let i = 0; i < args.length; i += 1) {
  if (args[i].startsWith('--')) {
    const key = args[i].slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) opts[key] = true;
    else {
      opts[key] = next;
      i += 1;
    }
  } else positional.push(args[i]);
}

const [rawUrl, out = 'artifacts/shot.png'] = positional;
if (!rawUrl) {
  console.error('usage: node tools/shot.mjs <url> [out.png] [--w --h --device --dpr --timeout --delay --stats]');
  process.exit(1);
}
const url = rawUrl.startsWith('http') ? rawUrl : `http://127.0.0.1:5190${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
const timeout = Number(opts.timeout ?? 45000);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
});
const contextOptions = opts.device
  ? { ...devices[opts.device] }
  : {
      viewport: { width: Number(opts.w ?? 1280), height: Number(opts.h ?? 720) },
      deviceScaleFactor: Number(opts.dpr ?? 1),
    };
const context = await browser.newContext(contextOptions);
const page = await context.newPage();
const problems = [];
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    const text = `[${msg.type()}] ${msg.text()}`;
    if (!problems.includes(text)) problems.push(text);
  }
});
page.on('pageerror', (error) => problems.push(`[pageerror] ${error.message}`));

const started = Date.now();
try {
  await page.goto(url, { waitUntil: 'load', timeout });
  await page.waitForFunction(() => window.__ready === true, null, { timeout });
  if (opts.delay) await page.waitForTimeout(Number(opts.delay));
  await page.screenshot({ path: out });
  if (opts.stats) {
    const stats = await page.evaluate(() => window.__labStats ?? window.__GAME__?.stats?.() ?? null);
    console.log(JSON.stringify(stats));
  }
  console.log(`saved ${out} in ${Date.now() - started}ms`);
} catch (error) {
  console.error(`shot failed: ${error.message}`);
  await page.screenshot({ path: out }).catch(() => {});
  process.exitCode = 1;
} finally {
  for (const p of problems.slice(0, 20)) console.log(p);
  await browser.close();
}
