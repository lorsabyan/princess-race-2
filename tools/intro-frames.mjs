#!/usr/bin/env node
/** Press Play and capture the intro cinematic at a few moments: node tools/intro-frames.mjs [--device "Pixel 7"] */
import { chromium, devices } from '@playwright/test';
const deviceArg = process.argv.indexOf('--device');
const device = deviceArg > 0 ? devices[process.argv[deviceArg + 1]] : { viewport: { width: 1280, height: 720 } };
const browser = await chromium.launch({ args: ['--use-angle=metal'] });
const page = await (await browser.newContext({ ...device, reducedMotion: 'reduce' })).newPage();
await page.goto(process.env.BASE_URL ?? 'http://127.0.0.1:5190/');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
await page.getByRole('button', { name: 'Play' }).click();
const start = Date.now();
for (const t of [0.6, 1.5, 2.2, 3.0, 4.2]) {
  await page.waitForTimeout(Math.max(0, t * 1000 - (Date.now() - start)));
  const name = `artifacts/game/intro-${t}${deviceArg > 0 ? '-phone' : ''}.png`;
  await page.screenshot({ path: name });
  console.log('saved', name);
}
await browser.close();
