export type OverlayState = 'hidden' | 'intro' | 'paused' | 'win' | 'failed';

export class Hud {
  private readonly scoreValue = this.getElement('#score-value');
  private readonly targetValue = this.getElement('#target-value');
  private readonly levelLabel = this.getElement('#level-label');
  private readonly progressFill = this.getElement('#progress-fill');
  private readonly heartRow = this.getElement('#heart-row');
  private readonly eventBanner = this.getElement('#event-banner');
  private readonly overlay = this.getElement('#game-overlay');
  private readonly overlayTitle = this.getElement('#overlay-title');
  private readonly overlayCopy = this.getElement('#overlay-copy');
  private readonly overlayKicker = this.getElement('#overlay-kicker');
  private readonly primaryAction = this.getElement('#primary-action');
  private readonly secondaryAction = this.getElement('#secondary-action');
  private readonly pauseButton = this.getElement('#pause-button');
  private readonly muteButton = this.getElement('#mute-button');
  private bannerTimeout = 0;

  setLevel(level: number, target: number): void {
    this.levelLabel.textContent = `Level ${level}`;
    this.targetValue.textContent = String(target);
  }

  update(score: number, target: number, progress: number, hearts: number, muted: boolean, paused: boolean): void {
    this.scoreValue.textContent = String(score);
    this.targetValue.textContent = String(target);
    this.progressFill.style.width = `${Math.max(0, Math.min(100, progress * 100))}%`;
    this.pauseButton.textContent = paused ? '▶' : 'II';
    this.pauseButton.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
    this.muteButton.textContent = muted ? '×' : '♪';
    this.renderHearts(hearts);
  }

  setOverlay(state: OverlayState, score = 0, target = 0): void {
    this.overlay.classList.toggle('hidden', state === 'hidden');
    this.secondaryAction.style.display = state === 'intro' ? 'none' : '';

    if (state === 'intro') {
      this.overlayKicker.textContent = 'Princess Coin Drive';
      this.overlayTitle.textContent = 'Ready';
      this.overlayCopy.textContent = 'The princess is getting into her rose car.';
      this.primaryAction.textContent = 'Start';
    } else if (state === 'paused') {
      this.overlayKicker.textContent = 'Paused';
      this.overlayTitle.textContent = 'Take a breath';
      this.overlayCopy.textContent = 'The city drive is waiting.';
      this.primaryAction.textContent = 'Resume';
      this.secondaryAction.textContent = 'Restart';
    } else if (state === 'win') {
      this.overlayKicker.textContent = 'Castle reached';
      this.overlayTitle.textContent = 'Level complete';
      this.overlayCopy.textContent = `Collected ${score}/${target} royal coins.`;
      this.primaryAction.textContent = 'Next level';
      this.secondaryAction.textContent = 'Replay';
    } else if (state === 'failed') {
      this.overlayKicker.textContent = 'Try again';
      this.overlayTitle.textContent = 'Gentle reset';
      this.overlayCopy.textContent = 'The princess car is ready for another smooth drive.';
      this.primaryAction.textContent = 'Retry';
      this.secondaryAction.textContent = 'Restart';
    }
  }

  flash(message: string): void {
    window.clearTimeout(this.bannerTimeout);
    this.eventBanner.textContent = message;
    this.eventBanner.classList.add('visible');
    this.bannerTimeout = window.setTimeout(() => {
      this.eventBanner.classList.remove('visible');
    }, 920);
  }

  pulseCoins(): void {
    this.scoreValue.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.18)' },
        { transform: 'scale(1)' },
      ],
      { duration: 220, easing: 'ease-out' },
    );
  }

  dispose(): void {
    window.clearTimeout(this.bannerTimeout);
  }

  private renderHearts(hearts: number): void {
    this.heartRow.replaceChildren();
    for (let index = 0; index < 3; index += 1) {
      const heart = document.createElement('span');
      heart.className = `heart${index >= hearts ? ' empty' : ''}`;
      this.heartRow.appendChild(heart);
    }
  }

  private getElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing HUD element: ${selector}`);
    return element;
  }
}
