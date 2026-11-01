/**
 * Car paints: coins banked from finished levels buy new colors. Nothing here can
 * be lost: bought paints stay bought and a level always adds to the wallet.
 */
export interface Paint {
  id: string;
  color: string;
  /** Coins to buy it; 0 means it comes with the car. */
  price: number;
}

export const PAINTS: readonly Paint[] = [
  { id: 'rose', color: '#ff6aa9', price: 0 },
  { id: 'lilac', color: '#b48aff', price: 40 },
  { id: 'sky', color: '#59b4ff', price: 80 },
  { id: 'mint', color: '#3bd3a4', price: 130 },
  { id: 'sun', color: '#ffbb36', price: 190 },
  { id: 'ruby', color: '#ff4a5f', price: 260 },
];

export interface Garage {
  wallet: number;
  /** Ids of the paints bought so far. */
  owned: string[];
  /** Id of the paint on the car. */
  paint: string;
}

export function emptyGarage(): Garage {
  return { wallet: 0, owned: [PAINTS[0].id], paint: PAINTS[0].id };
}

export function paintById(id: string): Paint | undefined {
  return PAINTS.find((p) => p.id === id);
}

export function owns(garage: Garage, id: string): boolean {
  return garage.owned.includes(id) || paintById(id)?.price === 0;
}

/** The next paint to save up for: the cheapest one not bought yet. */
export function nextPaint(garage: Garage): Paint | undefined {
  return PAINTS.find((p) => !owns(garage, p.id));
}

/** Share of a paint's price already in the wallet (0..1), for the ring around a swatch. */
export function savedFor(garage: Garage, paint: Paint): number {
  if (paint.price <= 0 || owns(garage, paint.id)) return 1;
  return Math.min(1, garage.wallet / paint.price);
}

/** Puts the paint on the car, buying it first if need be. False when it can't be afforded yet. */
export function choosePaint(garage: Garage, id: string): boolean {
  const paint = paintById(id);
  if (!paint) return false;
  if (!owns(garage, id)) {
    if (garage.wallet < paint.price) return false;
    garage.wallet -= paint.price;
    garage.owned = [...garage.owned, id];
  }
  garage.paint = id;
  return true;
}

/** A saved garage with anything unknown or impossible put right, so an old save can never break the game. */
export function cleanGarage(data: Partial<Garage> | undefined): Garage {
  const base = emptyGarage();
  const wallet = Number(data?.wallet);
  const known = (data?.owned ?? []).filter((id) => paintById(id));
  const owned = [...new Set([...base.owned, ...known])];
  const paint = data?.paint && owned.includes(data.paint) ? data.paint : base.paint;
  return { wallet: Number.isFinite(wallet) && wallet > 0 ? Math.floor(wallet) : 0, owned, paint };
}
