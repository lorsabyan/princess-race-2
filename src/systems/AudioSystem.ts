type AudioGroup = 'master' | 'sfx' | 'ui' | 'ambience' | 'music';

export class AudioSystem {
  private context: AudioContext | null = null;
  private readonly gains = new Map<AudioGroup, GainNode>();
  private engineOscillator: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private ambienceTimer = 0;
  private musicTimer = 0;
  private melodyStep = 0;
  private muted = false;
  private unlocked = false;

  constructor() {
    const unlock = () => {
      void this.unlock();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  async unlock(): Promise<void> {
    if (this.unlocked) return;
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    this.context = new AudioContextClass();
    const master = this.context.createGain();
    const sfx = this.context.createGain();
    const ui = this.context.createGain();
    const ambience = this.context.createGain();
    const music = this.context.createGain();
    master.gain.value = this.muted ? 0 : 0.72;
    sfx.gain.value = 0.82;
    ui.gain.value = 0.54;
    ambience.gain.value = 0.24;
    music.gain.value = 0.18;
    sfx.connect(master);
    ui.connect(master);
    ambience.connect(master);
    music.connect(master);
    master.connect(this.context.destination);
    this.gains.set('master', master);
    this.gains.set('sfx', sfx);
    this.gains.set('ui', ui);
    this.gains.set('ambience', ambience);
    this.gains.set('music', music);
    await this.context.resume();
    this.unlocked = true;
    this.startEngine();
  }

  update(delta: number, running: boolean, speedRatio: number): void {
    if (!this.context || !this.engineGain || !this.engineOscillator) return;
    const now = this.context.currentTime;
    const target = running ? 0.028 + speedRatio * 0.018 : 0.008;
    this.engineGain.gain.setTargetAtTime(this.muted ? 0 : target, now, 0.08);
    this.engineOscillator.frequency.setTargetAtTime(72 + speedRatio * 28, now, 0.12);

    this.ambienceTimer -= delta;
    if (running && this.ambienceTimer <= 0) {
      this.ambienceTimer = 3.6;
      this.softTone(176, 2.8, 'sine', 0.012, 'ambience', 0.08);
      this.softTone(220, 2.2, 'triangle', 0.008, 'ambience', 0.16);
    }

    this.musicTimer -= delta;
    if (running && this.musicTimer <= 0) {
      const motif = [392, 494, 587, 494, 440, 523, 659, 587];
      this.musicTimer = 0.38;
      const note = motif[this.melodyStep % motif.length];
      this.softTone(note, 0.34, 'sine', 0.018, 'music', 0);
      this.softTone(note / 2, 0.5, 'triangle', 0.01, 'music', 0.02);
      this.melodyStep += 1;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    const master = this.gains.get('master');
    if (!master || !this.context) return;
    master.gain.setTargetAtTime(muted ? 0 : 0.72, this.context.currentTime, 0.03);
  }

  isMuted(): boolean {
    return this.muted;
  }

  ui(): void {
    this.softTone(520, 0.09, 'triangle', 0.038, 'ui', 0);
    this.softTone(780, 0.11, 'sine', 0.024, 'ui', 0.035);
  }

  coin(index: number): void {
    const base = 560 + (index % 5) * 28;
    this.softTone(base, 0.13, 'triangle', 0.06, 'sfx', 0);
    this.softTone(base * 1.5, 0.18, 'sine', 0.04, 'sfx', 0.045);
  }

  charm(): void {
    this.softTone(420, 0.18, 'triangle', 0.052, 'sfx', 0);
    this.softTone(680, 0.2, 'sine', 0.056, 'sfx', 0.07);
    this.softTone(920, 0.22, 'sine', 0.038, 'sfx', 0.14);
  }

  bump(): void {
    this.noise(0.18, 0.08, 'sfx');
    this.softTone(132, 0.18, 'sawtooth', 0.026, 'sfx', 0.02);
  }

  shield(): void {
    this.softTone(330, 0.18, 'triangle', 0.038, 'sfx', 0);
    this.softTone(660, 0.22, 'sine', 0.032, 'sfx', 0.06);
  }

  levelStart(level: number): void {
    const root = 330 + Math.min(level, 5) * 12;
    [root, root * 1.25, root * 1.5].forEach((frequency, index) => {
      this.softTone(frequency, 0.16, 'triangle', 0.034, 'ui', index * 0.08);
    });
  }

  win(): void {
    [392, 494, 587, 784].forEach((frequency, index) => {
      this.softTone(frequency, 0.22, 'triangle', 0.052, 'sfx', index * 0.11);
    });
  }

  fail(): void {
    [260, 220, 174].forEach((frequency, index) => {
      this.softTone(frequency, 0.18, 'triangle', 0.042, 'sfx', index * 0.1);
    });
  }

  dispose(): void {
    this.engineOscillator?.stop();
    this.engineOscillator = null;
    this.engineGain = null;
    void this.context?.close();
    this.context = null;
  }

  private startEngine(): void {
    if (!this.context || this.engineOscillator) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sawtooth';
    oscillator.frequency.value = 72;
    gain.gain.value = 0;
    oscillator.connect(gain).connect(this.gains.get('ambience') ?? this.context.destination);
    oscillator.start();
    this.engineOscillator = oscillator;
    this.engineGain = gain;
  }

  private softTone(
    frequency: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    group: AudioGroup,
    delay: number,
  ): void {
    if (!this.context || this.context.state !== 'running') return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime + delay;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.08, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.gains.get(group) ?? this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.03);
  }

  private noise(duration: number, volume: number, group: AudioGroup): void {
    if (!this.context || this.context.state !== 'running') return;
    const sampleRate = this.context.sampleRate;
    const buffer = this.context.createBuffer(1, Math.floor(sampleRate * duration), sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / data.length);
    }
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    gain.gain.value = volume;
    source.buffer = buffer;
    source.connect(gain).connect(this.gains.get(group) ?? this.context.destination);
    source.start();
  }
}
