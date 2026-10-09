import { expect, test, type Page } from '@playwright/test';

interface GameStats {
  mode: string;
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
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `artifacts/e2e/${info.project.name}-results.png` });
  const s = await stats(page);
  expect(s.sim!.phase).toBe('done');
  expect(s.sim!.collected).toBeGreaterThan(50);
  expect(errors).toEqual([]);
});
