export type GameIntent = 'pause' | 'mute' | 'primary' | 'restart';

type PointerState = {
  active: boolean;
  id: number | null;
  centerX: number;
  centerY: number;
};

export class InputController {
  private readonly keys = new Set<string>();
  private readonly pointerState: PointerState = {
    active: false,
    id: null,
    centerX: 0,
    centerY: 0,
  };

  private wheelSteer = 0;
  private keyboardSteer = 0;
  private readonly disposers: Array<() => void> = [];

  private readonly onKeyDown = (event: KeyboardEvent) => {
    this.keys.add(event.code);
    if (event.code === 'Space' || event.code === 'Enter') this.emit('primary');
    if (event.code === 'KeyP' || event.code === 'Escape') this.emit('pause');
    if (event.code === 'KeyM') this.emit('mute');
    if (event.code === 'KeyR') this.emit('restart');
    this.updateKeyboardSteer();
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
    this.updateKeyboardSteer();
  };

  private readonly onWheelDown = (event: PointerEvent) => {
    event.preventDefault();
    const rect = this.wheel.getBoundingClientRect();
    this.pointerState.active = true;
    this.pointerState.id = event.pointerId;
    this.pointerState.centerX = rect.left + rect.width / 2;
    this.pointerState.centerY = rect.top + rect.height / 2;
    try {
      this.wheel.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic test events may not provide a capturable pointer id.
    }
    this.updateWheel(event.clientX, event.clientY);
  };

  private readonly onWheelMove = (event: PointerEvent) => {
    if (!this.pointerState.active || event.pointerId !== this.pointerState.id) return;
    event.preventDefault();
    this.updateWheel(event.clientX, event.clientY);
  };

  private readonly onWheelUp = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerState.id) return;
    event.preventDefault();
    this.pointerState.active = false;
    this.pointerState.id = null;
    this.wheelSteer = 0;
    this.applyWheelTransform();
  };

  private readonly onBlur = () => {
    this.keys.clear();
    this.keyboardSteer = 0;
    this.wheelSteer = 0;
    this.pointerState.active = false;
    this.pointerState.id = null;
    this.applyWheelTransform();
  };

  constructor(
    private readonly wheel: HTMLElement,
    pauseButton: HTMLElement,
    muteButton: HTMLElement,
    primaryAction: HTMLElement,
    secondaryAction: HTMLElement,
    private readonly onIntent: (intent: GameIntent) => void,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onBlur);
    this.wheel.addEventListener('pointerdown', this.onWheelDown);
    this.wheel.addEventListener('pointermove', this.onWheelMove);
    this.wheel.addEventListener('pointerup', this.onWheelUp);
    this.wheel.addEventListener('pointercancel', this.onWheelUp);
    this.wheel.addEventListener('lostpointercapture', this.onWheelUp);

    this.bindButton(pauseButton, 'pause');
    this.bindButton(muteButton, 'mute');
    this.bindButton(primaryAction, 'primary');
    this.bindButton(secondaryAction, 'restart');
  }

  getSteer(): number {
    return Math.max(-1, Math.min(1, this.keyboardSteer + this.wheelSteer));
  }

  isSteering(): boolean {
    return Math.abs(this.getSteer()) > 0.04;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onBlur);
    this.wheel.removeEventListener('pointerdown', this.onWheelDown);
    this.wheel.removeEventListener('pointermove', this.onWheelMove);
    this.wheel.removeEventListener('pointerup', this.onWheelUp);
    this.wheel.removeEventListener('pointercancel', this.onWheelUp);
    this.wheel.removeEventListener('lostpointercapture', this.onWheelUp);
    for (const dispose of this.disposers) dispose();
  }

  private bindButton(button: HTMLElement, intent: GameIntent): void {
    const handler = (event: Event) => {
      event.preventDefault();
      this.emit(intent);
    };
    button.addEventListener('click', handler);
    this.disposers.push(() => button.removeEventListener('click', handler));
  }

  private emit(intent: GameIntent): void {
    this.onIntent(intent);
  }

  private updateKeyboardSteer(): void {
    let steer = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) steer -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) steer += 1;
    this.keyboardSteer = steer;
  }

  private updateWheel(clientX: number, clientY: number): void {
    const dx = clientX - this.pointerState.centerX;
    const dy = clientY - this.pointerState.centerY;
    if (Math.hypot(dx, dy) < 12) {
      this.wheelSteer = 0;
    } else {
      const angle = Math.atan2(dy, dx) + Math.PI / 2;
      this.wheelSteer = Math.max(-1, Math.min(1, angle / 1.05));
    }
    this.applyWheelTransform();
  }

  private applyWheelTransform(): void {
    this.wheel.style.transform = `rotate(${this.wheelSteer * 54}deg)`;
  }
}
