import type { ModelLibrary } from './contracts';
import { placeholderLibrary } from './placeholders';

type Loader = () => Promise<Record<string, unknown>>;

/**
 * Model modules are discovered by glob so a missing or broken module falls back
 * to its placeholder instead of taking the whole game down.
 */
const sources: Record<string, Record<string, Loader>> = {
  car: import.meta.glob<Record<string, unknown>>(['./car/*.ts', '!./car/*.lab.ts']),
  princess: import.meta.glob<Record<string, unknown>>(['./princess/*.ts', '!./princess/*.lab.ts']),
  town: import.meta.glob<Record<string, unknown>>(['./town/*.ts', '!./town/*.lab.ts']),
  items: import.meta.glob<Record<string, unknown>>(['./items/*.ts', '!./items/*.lab.ts']),
  landmarks: import.meta.glob<Record<string, unknown>>(['./landmarks/*.ts', '!./landmarks/*.lab.ts']),
};

const EXPORTS: Array<[keyof ModelLibrary, string, string]> = [
  ['createCar', 'car', 'createCar'],
  ['createPrincess', 'princess', 'createPrincess'],
  ['buildTownChunk', 'town', 'buildTownChunk'],
  ['chunkLength', 'town', 'CHUNK_LENGTH'],
  ['createCoinGeometry', 'items', 'createCoinGeometry'],
  ['coinMaterial', 'items', 'coinMaterial'],
  ['createHeartGemGeometry', 'items', 'createHeartGemGeometry'],
  ['heartGemMaterial', 'items', 'heartGemMaterial'],
  ['createObstacle', 'items', 'createObstacle'],
  ['createCastleGate', 'landmarks', 'createCastleGate'],
  ['createPrincessHome', 'landmarks', 'createPrincessHome'],
  ['createBackdrop', 'landmarks', 'createBackdrop'],
];

export interface LibraryReport {
  real: string[];
  placeholder: string[];
}

export async function loadModelLibrary(): Promise<{ library: ModelLibrary; report: LibraryReport }> {
  const library: ModelLibrary = { ...placeholderLibrary };
  const report: LibraryReport = { real: [], placeholder: [] };
  const modules: Record<string, Record<string, unknown>[]> = {};

  await Promise.all(
    Object.entries(sources).map(async ([area, loaders]) => {
      modules[area] = [];
      for (const [path, load] of Object.entries(loaders)) {
        try {
          modules[area].push(await load());
        } catch (error) {
          console.warn(`[models] ${path} failed to load, using placeholders`, error);
        }
      }
    }),
  );

  for (const [key, area, name] of EXPORTS) {
    const found = modules[area]?.find((m) => name in m)?.[name];
    if (found !== undefined) {
      (library as unknown as Record<string, unknown>)[key] = found;
      report.real.push(key);
    } else {
      report.placeholder.push(key);
    }
  }
  return { library, report };
}
