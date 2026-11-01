/**
 * Rose Town palette. Every model pulls colors from here so the world reads as one
 * storybook: sunny pastels, warm cream whites, and a few saturated accents
 * (berry, gold, mint) reserved for things the player should notice.
 */
export const PAL = {
  // Sky and atmosphere
  skyTop: '#5fb2ff',
  skyMid: '#a8d8ff',
  skyHorizon: '#ffe7d6',
  sunGlow: '#fff4dc',
  haze: '#f7e3ef',

  // Ground
  grass: '#96d68a',
  grassDeep: '#6dbf74',
  grassLight: '#b8eca4',
  soil: '#c98f68',
  road: '#f1d7df',
  roadDeep: '#ddb6c4',
  roadLine: '#ffffff',
  curb: '#fffaf4',
  sidewalk: '#f8e9dc',
  sidewalkDeep: '#ead3c1',
  stone: '#efe4dc',
  stoneDeep: '#d8c6bb',

  // Walls
  wallCream: '#fff0dc',
  wallBlush: '#ffc4d4',
  wallMint: '#bfeccf',
  wallButter: '#ffe9a0',
  wallLavender: '#dccfff',
  wallPeach: '#ffcdb0',
  wallSky: '#c6e3ff',

  // Roofs
  roofCoral: '#ff8198',
  roofBerry: '#e35a82',
  roofTeal: '#4fb8ad',
  roofLilac: '#a78be0',
  roofTerracotta: '#ee8d63',
  roofBlue: '#6f8fe0',

  // Trim and details
  trimWhite: '#fffaf6',
  wood: '#c98e62',
  woodDeep: '#9d6845',
  doorBerry: '#d9557c',
  doorTeal: '#3ea79c',
  doorLilac: '#8e72d4',
  glass: '#bfe4ff',
  lampGlow: '#fff1c4',
  iron: '#5b5470',

  // Foliage
  leaf: '#7fd38b',
  leafSage: '#a3d67f',
  leafDeep: '#4ea86a',
  blossom: '#ffb3cf',
  blossomLight: '#ffd7e6',
  trunk: '#b98059',

  // Flowers
  flowerRose: '#ff5c86',
  flowerRed: '#ff4f63',
  flowerYellow: '#ffd84d',
  flowerWhite: '#ffffff',
  flowerLilac: '#c7a4ff',
  flowerBlue: '#79c6ff',
  flowerOrange: '#ffa24d',

  // Hero car
  carPaint: '#ff6aa9',
  carPaintDeep: '#e2408b',
  carInterior: '#e0578c',
  seat: '#fff3e6',
  seatTuft: '#f3dccb',
  tire: '#3b3346',
  whitewall: '#fffaf4',
  chrome: '#f2f2f7',
  gold: '#ffd46b',
  goldDeep: '#e9a93a',
  headlight: '#fff8e0',
  tailLight: '#ff4d7d',

  // Princess
  skin: '#ffd5be',
  skinShade: '#e9a98a',
  cheek: '#ff9aa8',
  hair: '#7f4326',
  hairLight: '#b56f3e',
  dress: '#ff9cc6',
  dressLight: '#ffd0e3',
  dressDeep: '#f27aae',
  pearl: '#fff8f2',
  eye: '#3b2438',
  gemPink: '#ff4f9e',
  gemBlue: '#58d0ff',
  gemMint: '#5fe0b8',

  // Rewards and hazards
  coin: '#ffd35e',
  coinDeep: '#f2a93b',
  heartGem: '#ff4f8b',
  cone: '#ff9a5c',
  coneStripe: '#fffaf2',
  duck: '#ffe062',
  duckBeak: '#ff9a3c',
  cart: '#ffb86b',
} as const;

export type PaletteKey = keyof typeof PAL;

/** House wall/roof/door combinations that look good together. */
export const HOUSE_SCHEMES = [
  { wall: PAL.wallBlush, roof: PAL.roofBerry, door: PAL.doorTeal, trim: PAL.trimWhite },
  { wall: PAL.wallCream, roof: PAL.roofCoral, door: PAL.doorLilac, trim: PAL.trimWhite },
  { wall: PAL.wallMint, roof: PAL.roofTeal, door: PAL.doorBerry, trim: PAL.trimWhite },
  { wall: PAL.wallButter, roof: PAL.roofTerracotta, door: PAL.doorTeal, trim: PAL.trimWhite },
  { wall: PAL.wallLavender, roof: PAL.roofLilac, door: PAL.doorBerry, trim: PAL.trimWhite },
  { wall: PAL.wallPeach, roof: PAL.roofBlue, door: PAL.doorLilac, trim: PAL.trimWhite },
  { wall: PAL.wallSky, roof: PAL.roofCoral, door: PAL.doorBerry, trim: PAL.trimWhite },
] as const;
