#!/usr/bin/env node
/** Print a level's obstacles (and coin count) from the running game: node tools/level-info.mjs [level] */
import { chromium } from '@playwright/test';
const level = process.argv[2] ?? '1';
const browser = await chromium.launch({ args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
await page.goto(`http://127.0.0.1:5190/?level=${level}&q=low`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
const info = await page.evaluate(() => {
  const sim = window.__GAME__.game.sim;
  return { length: sim.level.length, coins: sim.totalCoins, obstacles: sim.level.obstacles.map((o) => `${o.kind}@${Math.round(-o.z)}m x=${o.x.toFixed(1)}`) };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
