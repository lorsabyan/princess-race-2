#!/usr/bin/env node
/**
 * Renders the PWA / home-screen icons from inline SVG with headless Chromium.
 *   node tools/make-icons.mjs
 * Writes public/icons/{icon-192,icon-512,maskable-512,apple-touch-icon}.png and public/favicon.svg.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const crown = `
<svg viewBox="0 0 64 44" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff6c4"/><stop offset="1" stop-color="#ffbb33"/>
    </linearGradient>
  </defs>
  <path d="M6 14.5 18 25 29.4 6.8c1.2-1.9 4-1.9 5.2 0L46 25l12-10.5c1.8-1.6 4.6.1 4 2.5l-5.8 21.4c-.4 1.5-1.7 2.6-3.3 2.6H11.1c-1.6 0-2.9-1.1-3.3-2.6L2 17c-.6-2.4 2.2-4.1 4-2.5z"
    fill="url(#g)" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/>
  <circle cx="32" cy="29" r="4.4" fill="#ff4f9e"/>
  <circle cx="17" cy="32" r="3.1" fill="#58d0ff"/>
  <circle cx="47" cy="32" r="3.1" fill="#58d0ff"/>
</svg>`;

const coin = `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2a8"/><stop offset=".45" stop-color="#ffd35e"/><stop offset="1" stop-color="#f0a02e"/></linearGradient></defs>
  <circle cx="32" cy="34" r="25" fill="#d9851f"/><circle cx="32" cy="31" r="25" fill="url(#c)" stroke="#fff" stroke-width="3"/>
  <path d="M32 42.5 22 33c-3.6-3.4-1.6-10 3.6-10 2.6 0 4.8 1.6 6.4 3.9 1.6-2.3 3.8-3.9 6.4-3.9 5.2 0 7.2 6.6 3.6 10z" fill="#ffb83d"/>
</svg>`;

function page(size, padding) {
  return `<!doctype html><html><body style="margin:0">
  <div id="icon" style="width:${size}px;height:${size}px;position:relative;overflow:hidden;
    background: radial-gradient(120% 90% at 30% 15%, #ffd1e6 0%, #ff8cc4 45%, #ee4a8f 100%);">
    <div style="position:absolute;inset:${padding}px;display:flex;flex-direction:column;align-items:center;justify-content:center;">
      <div style="width:66%;filter:drop-shadow(0 ${size * 0.02}px ${size * 0.03}px rgba(122,33,86,.45))">${crown}</div>
      <div style="width:34%;margin-top:-${size * 0.02}px;filter:drop-shadow(0 ${size * 0.015}px ${size * 0.025}px rgba(122,33,86,.4))">${coin}</div>
    </div>
  </div></body></html>`;
}

mkdirSync('public/icons', { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 1 });
const p = await ctx.newPage();
const jobs = [
  ['public/icons/icon-512.png', 512, 40],
  ['public/icons/icon-192.png', 192, 15],
  ['public/icons/maskable-512.png', 512, 110],
  ['public/icons/apple-touch-icon.png', 180, 16],
];
for (const [path, size, padding] of jobs) {
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(page(size, padding));
  await p.locator('#icon').screenshot({ path });
  console.log('wrote', path);
}
await browser.close();

writeFileSync(
  'public/favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#ff5fa2"/><g transform="translate(6 12) scale(.82)">${crown.replace(/<\/?svg[^>]*>/g, '')}</g></svg>`,
);
console.log('wrote public/favicon.svg');
