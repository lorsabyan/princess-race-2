#!/usr/bin/env node
/** Triangle count of the car rig vs the princess rig in the running game. */
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.goto('http://127.0.0.1:5190/?autoplay&freeze=3');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
const out = await page.evaluate(() => {
  const g = window.__GAME__.game;
  const count = (root, skip) => {
    let tris = 0; const parts = [];
    root.traverse((o) => {
      if (skip && (o === skip || skip.getObjectById(o.id))) return;
      if (!o.isMesh) return;
      const geo = o.geometry; const n = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      tris += n; parts.push(`${o.name || '?'}:${Math.round(n)}`);
    });
    return { tris: Math.round(tris), parts: parts.sort((a, b) => Number(b.split(':')[1]) - Number(a.split(':')[1])).slice(0, 12) };
  };
  return { car: count(g.car.root, g.princess.root), princess: count(g.princess.root) };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
