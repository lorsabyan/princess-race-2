import { expect, test, type Page } from '@playwright/test';

interface GameStats {
  mode: string;
  level: number;
  sim: { phase: string; x: number; z: number; collected: number; time: number } | null;
  renderer: { calls: number; triangles: number };
}

async function stats(page: Page): Promise<GameStats> {
  await page.waitForFunction(() => !!window.__GAME__);
  return page.evaluate(() => window.__GAME__!.stats() as unknown as GameStats);
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('title -> play -> steer -> collect coins', async ({ page }, info) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await page.screenshot({ path: `artifacts/e2e/${info.project.name}-title.png` });

  await page.getByRole('button', { name: 'Play' }).click();
  await expect.poll(async () => (await stats(page)).mode, { timeout: 15_000 }).toBe('drive');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

  // Drag across the screen: the car must follow.
  const box = (await page.locator('#stage').boundingBox())!;
  const y = box.y + box.height * 0.7;
  const startX = box.x + box.width * 0.5;
  const before = (await stats(page)).sim!.x;
  if (info.project.name === 'desktop') {
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + box.width * 0.25, y, { steps: 8 });
    await page.waitForTimeout(500);
    await page.mouse.up();
  } else {
    // Quick tap on the right half hops a lane to the right.
    await page.touchscreen.tap(box.x + box.width * 0.85, y);
    await page.waitForTimeout(600);
  }
  await expect.poll(async () => (await stats(page)).sim!.x).toBeGreaterThan(before + 0.8);

  // Keep driving a bit; coins should be collected along the starting line.
  await expect.poll(async () => (await stats(page)).sim!.collected, { timeout: 20_000 }).toBeGreaterThan(0);
  await page.screenshot({ path: `artifacts/e2e/${info.project.name}-drive.png` });

  // Pause and resume.
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  const pausedZ = (await stats(page)).sim!.z;
  await page.waitForTimeout(400);
  expect((await stats(page)).sim!.z).toBe(pausedZ);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect.poll(async () => (await stats(page)).sim!.z).toBeLessThan(pausedZ - 1);

  const s = await stats(page);
  expect(s.renderer.calls).toBeLessThan(250);
  expect(errors).toEqual([]);
});

test('a full level reaches the castle and shows stars', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one full run is enough');
  const errors = collectErrors(page);
  // Bot drives, time is sped up by skipping the intro.
  test.setTimeout(180_000);
  await page.goto('/?autoplay&bot&timescale=3');
  await expect.poll(async () => (await stats(page)).mode, { timeout: 30_000 }).toBe('drive');
  await expect.poll(async () => (await stats(page)).mode, { timeout: 150_000, intervals: [2000] }).toBe('results');
  await expect(page.getByRole('button', { name: 'Next level' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Paint lilac' })).toBeVisible();
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `artifacts/e2e/${info.project.name}-results.png` });
  const s = await stats(page);
  expect(s.sim!.phase).toBe('done');
  expect(s.sim!.collected).toBeGreaterThan(50);
  expect(errors).toEqual([]);
});

test('the title buttons never overlap, on any common screen', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one browser is enough');
  const errors = collectErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [768, 1024], [640, 360], [844, 390], [960, 540], [1024, 600], [1280, 720], [1440, 810], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    const clashes = await page.evaluate(() => {
      const rect = (el: Element) => el.getBoundingClientRect();
      const parts = [...document.querySelectorAll('.swatch, .swatch-price, .title-wallet, .map-btn, .play-btn, .corner-br .round-btn')];
      const found: string[] = [];
      for (const [i, a] of parts.entries()) {
        for (const b of parts.slice(i + 1)) {
          if (a.contains(b) || b.contains(a) || (a.closest('.swatch') && a.closest('.swatch') === b.closest('.swatch'))) continue;
          const p = rect(a);
          const q = rect(b);
          if (p.left < q.right && q.left < p.right && p.top < q.bottom && q.top < p.bottom) found.push(`${a.className} / ${b.className}`);
        }
        const p = rect(a);
        if (p.left < 0 || p.top < 0 || p.right > innerWidth || p.bottom > innerHeight) found.push(`${a.className} off screen`);
      }
      return found;
    });
    expect(clashes, `${width}x${height}`).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test('coins buy paint, and the map changes level and time of day', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one browser is enough');
  const errors = collectErrors(page);
  const save = { level: 4, bestStars: { 1: 3 }, muted: true, garage: { wallet: 100, owned: ['rose'], paint: 'rose' } };
  await page.addInitScript((s) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('princess-coin-drive:v1', JSON.stringify(s));
      sessionStorage.setItem('seeded', '1');
    }
  }, save);
  await page.goto('/');
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('princess-coin-drive:v1')!).garage);

  // Too dear: nothing is taken.
  await page.getByRole('button', { name: 'Paint ruby' }).click({ force: true });
  expect(await page.evaluate(() => localStorage.getItem('princess-coin-drive:v1'))).toContain('"wallet":100');

  // Affordable: bought, worn, remembered, and it survives a reload.
  await page.getByRole('button', { name: 'Paint sky' }).click({ force: true });
  await expect.poll(saved).toEqual({ wallet: 20, owned: ['rose', 'sky'], paint: 'sky' });
  await page.reload();
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
  await expect(page.getByLabel('20 coins')).toBeVisible();

  // The map opens levels up to the furthest reached, and no further.
  await page.getByRole('button', { name: 'Map' }).click({ force: true });
  await expect(page.getByRole('button', { name: 'Level 5' })).toBeDisabled();
  await page.screenshot({ path: `artifacts/e2e/${info.project.name}-map.png` });
  await page.getByRole('button', { name: 'Level 3', exact: true }).click({ force: true });
  await expect.poll(async () => (await stats(page)).level, { timeout: 30_000 }).toBe(3);
  await expect.poll(async () => (await stats(page)).mode, { timeout: 30_000 }).toBe('title');

  await page.getByRole('button', { name: 'Play' }).click();
  await expect.poll(async () => (await stats(page)).mode, { timeout: 15_000 }).toBe('drive');
  expect(errors).toEqual([]);
});

test('installs and plays offline after the first visit', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'desktop', 'one browser is enough');
  const errors = collectErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });

  // Installable: a complete manifest with the home-screen icons.
  const manifest = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
  expect(manifest.name).toBe('Princess Race 3');
  expect(manifest.display).toBe('fullscreen');
  const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toContain('192x192');
  expect(sizes).toContain('512x512');

  // Offline: wait for the service worker to take over, then cut the network.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Play' }).click();
  await expect.poll(async () => (await stats(page)).mode, { timeout: 15_000 }).toBe('drive');
  await expect.poll(async () => (await stats(page)).sim!.collected, { timeout: 20_000 }).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
