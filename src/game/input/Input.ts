import { TUNING } from '../sim/config';

export type InputAction = 'pause' | 'honk' | 'confirm';

/**
 * Kid-friendly steering:
 * - Drag anywhere: the car follows the finger's horizontal movement (relative, no jumps).
 *   Only the first finger counts, so a resting palm can't hijack the car.
 * - Quick tap on the left/right half: hop one lane that way.
 * - Keyboard: arrows / A-D glide, Space = horn, Esc/P = pause, Enter = confirm.
 */
export class Input {
  enabled = false;
  targetX = 0;
  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private startTime = 0;
  private startTarget = 0;
  private moved = false;
  private keyDir = 0;
  private readonly keys = new Set<string>();
  private readonly disposers: Array<() => void> = [];

  constructor(
    private readonly surface: HTMLElement,
    private readonly onAction: (action: InputAction) => void,
  ) {
    this.listen(surface, 'pointerdown', this.onDown as EventListener);
    this.listen(window, 'pointermove', this.onMove as EventListener);
    this.listen(window, 'pointerup', this.onUp as EventListener);
    this.listen(window, 'pointercancel', this.onUp as EventListener);
    this.listen(window, 'keydown', this.onKeyDown as EventListener);
    this.listen(window, 'keyup', this.onKeyUp as EventListener);
    this.listen(window, 'blur', this.reset);
    this.listen(document, 'visibilitychange', this.reset);
  }

  /** Sync with the sim (e.g. after a bump pushed the car sideways). */
  syncTo(x: number): void {
    this.targetX = x;
    if (this.pointerId !== null) this.startTarget = x - (this.lastDx * this.sensitivity());
  }

  update(dt: number): number {
    if (this.keyDir !== 0 && this.enabled) {
      this.targetX = clamp(this.targetX + this.keyDir * 7.5 * dt);
    }
    return this.targetX;
  }

  get dragging(): boolean {
    return this.pointerId !== null;
  }

  dispose(): void {
    for (const d of this.disposers) d();
  }

  private lastDx = 0;

  private sensitivity(): number {
    // Sweeping ~55% of the screen width covers the whole drivable road.
    const width = Math.max(320, this.surface.clientWidth || window.innerWidth);
    return (TUNING.driveHalf * 2) / (width * 0.55);
  }

  private readonly onDown = (e: PointerEvent) => {
    if (!this.enabled || this.pointerId !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.pointerId = e.pointerId;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.startTime = performance.now();
    this.startTarget = this.targetX;
    this.moved = false;
    this.lastDx = 0;
  };

  private readonly onMove = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    const dx = e.clientX - this.startX;
    if (Math.abs(dx) > 8 || Math.abs(e.clientY - this.startY) > 8) this.moved = true;
    this.lastDx = dx;
    this.targetX = clamp(this.startTarget + dx * this.sensitivity());
  };

  private readonly onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    const quick = performance.now() - this.startTime < 260;
    if (!this.moved && quick && this.enabled) {
      const width = this.surface.clientWidth || window.innerWidth;
      const dir = e.clientX < width / 2 ? -1 : 1;
      this.targetX = clamp(nearestLane(this.targetX) + dir * 2.3);
    }
  };

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat && (e.code === 'Space' || e.code === 'Escape')) return;
    this.keys.add(e.code);
    if (e.code === 'Escape' || e.code === 'KeyP') this.onAction('pause');
    else if (e.code === 'Space') {
      e.preventDefault();
      this.onAction('honk');
    } else if (e.code === 'Enter') this.onAction('confirm');
    this.updateKeys();
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    this.updateKeys();
  };

  private readonly reset = () => {
    this.keys.clear();
    this.keyDir = 0;
    this.pointerId = null;
  };

  private updateKeys(): void {
    let dir = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) dir -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) dir += 1;
    this.keyDir = dir;
  }

  private listen(target: EventTarget, type: string, handler: EventListener): void {
    target.addEventListener(type, handler, { passive: true });
    this.disposers.push(() => target.removeEventListener(type, handler));
  }
}

function clamp(x: number): number {
  return Math.max(-TUNING.driveHalf, Math.min(TUNING.driveHalf, x));
}

function nearestLane(x: number): number {
  const lanes = [-2.3, 0, 2.3];
  return lanes.reduce((best, l) => (Math.abs(l - x) < Math.abs(best - x) ? l : best), lanes[0]);
}
