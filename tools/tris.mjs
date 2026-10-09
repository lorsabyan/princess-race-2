#!/usr/bin/env node
/** Visible triangle breakdown by scene object: node tools/tris.mjs "/?autoplay&freeze=6" */
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const url = process.argv[2] ?? '/?autoplay&freeze=6';
await page.goto(url.startsWith('http') ? url : 'http://127.0.0.1:5190' + url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
const out = await page.evaluate(() => {
  const scene = window.__GAME__.game.scene;
  const rows = [];
  const count = (root) => {
    let tris = 0, meshes = 0;
    root.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      let vis = true; let p = o; while (p) { if (!p.visible) { vis = false; break; } p = p.parent; }
      if (!vis) return;
      const g = o.geometry; const n = g.index ? g.index.count : g.attributes.position.count;
      const inst = o.isInstancedMesh ? o.count : (g.isInstancedBufferGeometry ? g.instanceCount : 1);
      tris += (n / 3) * inst; meshes += 1;
    });
    return { tris: Math.round(tris), meshes };
  };
  for (const child of scene.children) {
    if (child.isLight) continue;
    const name = child.name || child.type;
    if (child.children.length > 3 && child.type === 'Group' && !child.name) {
      for (const c of child.children) { const r = count(c); if (r.meshes) rows.push({ name: `${name}/${c.name || c.type}`, ...r }); }
    } else { const r = count(child); if (r.meshes) rows.push({ name, ...r }); }
  }
  return rows.sort((a, b) => b.tris - a.tris).slice(0, 25);
});
console.table(out);
await browser.close();
