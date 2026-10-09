/**
 * Procedural audio: a music-box style soundtrack plus gentle SFX, synthesized
 * with Web Audio so the game needs no audio files. Everything routes through a
 * soft reverb and a limiter so nothing is ever harsh for little ears.
 */

type Song = 'title' | 'drive' | 'results' | null;

// C major pentatonic across octaves (MIDI numbers).
const PENTA = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84, 86, 88];
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

interface SongDef {
  bpm: number;
  bars: number;
  /** One chord (root MIDI + intervals) per bar. */
  chords: number[][];
  /** Melody: [step (16ths), MIDI note, length in 16ths] */
  melody: Array<[number, number, number]>;
  drums: boolean;
}

const C = [48, 55, 64, 67];
const Am = [45, 52, 60, 64];
const F = [41, 48, 57, 60];
const G = [43, 50, 59, 62];
const Em = [40, 47, 55, 59];

const SONGS: Record<Exclude<Song, null>, SongDef> = {
  title: {
    bpm: 84,
    bars: 8,
    chords: [C, Am, F, G, C, Em, F, G],
    melody: [
      [0, 76, 4], [4, 79, 2], [6, 76, 2], [8, 74, 4], [12, 72, 4],
      [16, 72, 4], [20, 74, 2], [22, 72, 2], [24, 69, 8],
      [32, 69, 4], [36, 72, 2], [38, 74, 2], [40, 76, 4], [44, 74, 4],
      [48, 74, 6], [54, 72, 2], [56, 71, 8],
      [64, 76, 4], [68, 79, 2], [70, 81, 2], [72, 79, 4], [76, 76, 4],
      [80, 74, 4], [84, 76, 2], [86, 74, 2], [88, 71, 8],
      [96, 72, 4], [100, 74, 2], [102, 76, 2], [104, 77, 4], [108, 76, 4],
      [112, 74, 6], [118, 71, 2], [120, 72, 8],
    ],
    drums: false,
  },
  drive: {
    bpm: 108,
    bars: 8,
    chords: [C, G, Am, F, C, G, F, G],
    melody: [
      [0, 72, 2], [2, 76, 2], [4, 79, 2], [6, 76, 2], [8, 81, 3], [11, 79, 1], [12, 76, 4],
      [16, 74, 2], [18, 79, 2], [20, 74, 2], [22, 71, 2], [24, 74, 4], [28, 79, 4],
      [32, 76, 2], [34, 72, 2], [36, 76, 2], [38, 81, 2], [40, 84, 4], [44, 81, 4],
      [48, 79, 2], [50, 77, 2], [52, 76, 2], [54, 74, 2], [56, 72, 4], [60, 74, 4],
      [64, 72, 2], [66, 76, 2], [68, 79, 2], [70, 84, 2], [72, 81, 3], [75, 79, 1], [76, 76, 4],
      [80, 74, 2], [82, 76, 2], [84, 79, 2], [86, 74, 2], [88, 71, 4], [92, 74, 4],
      [96, 77, 2], [98, 76, 2], [100, 74, 2], [102, 72, 2], [104, 69, 4], [108, 72, 4],
      [112, 74, 3], [115, 76, 1], [116, 79, 4], [120, 74, 4], [124, 71, 4],
    ],
    drums: true,
  },
  results: {
    bpm: 92,
    bars: 4,
    chords: [F, G, Em, Am],
    melody: [
      [0, 77, 4], [4, 76, 4], [8, 72, 4], [12, 69, 4],
      [16, 74, 4], [20, 76, 4], [24, 79, 8],
      [32, 76, 4], [36, 74, 4], [40, 71, 4], [44, 67, 4],
      [48, 69, 4], [52, 72, 4], [56, 76, 8],
    ],
    drums: false,
  },
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private sfx!: GainNode;
  private reverbSend!: GainNode;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private song: Song = null;
  private songStart = 0;
  private nextStep = 0;
  private schedulerTimer = 0;
  private musicOn = true;
  muted = false;

  /** Must be called from a user gesture (tap/click/key). Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 8;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.2;
    limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    this.master.connect(limiter);
    this.music = ctx.createGain();
    this.music.gain.value = 0.32;
    this.music.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.7;
    this.sfx.connect(this.master);
    const reverb = ctx.createConvolver();
    reverb.buffer = this.makeImpulse(2.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.28;
    reverb.connect(wet).connect(this.master);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 1;
    this.reverbSend.connect(reverb);
    this.noiseBuffer = this.makeNoise(1.5);
    if (this.song) this.startSong(this.song, true);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(muted ? 0 : 0.85, this.ctx.currentTime, 0.05);
  }

  /** Suspend everything while the tab is hidden. */
  setSuspended(suspended: boolean): void {
    if (!this.ctx) return;
    if (suspended) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  playSong(song: Song): void {
    if (song === this.song) return;
    this.song = song;
    if (this.ctx) this.startSong(song, false);
  }

  setMusicEnabled(on: boolean): void {
    this.musicOn = on;
    if (this.ctx) this.music.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.2);
  }

  // ---------------------------------------------------------------------------
  // SFX
  // ---------------------------------------------------------------------------

  coin(combo: number): void {
    const note = PENTA[Math.min(PENTA.length - 1, 5 + ((combo - 1) % 8))];
    this.bell(midi(note + 12), 0, 0.5, 0.22, this.sfx);
    this.bell(midi(note + 19), 0.045, 0.35, 0.09, this.sfx);
  }

  gem(): void {
    [72, 76, 79, 84, 88].forEach((n, i) => this.bell(midi(n + 12), i * 0.06, 0.8, 0.18, this.sfx));
    this.shimmer(0.25, 0.9);
  }

  bump(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.32);
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 18;
    lfoGain.gain.value = 30;
    lfo.connect(lfoGain).connect(osc.frequency);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    osc.connect(gain).connect(this.sfx);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 0.45);
    lfo.stop(t + 0.45);
    this.noise(0.12, 0.18, 900, 'lowpass');
  }

  splash(): void {
    this.noise(0.45, 0.32, 2400, 'bandpass', 600);
    for (let i = 0; i < 6; i += 1) {
      this.blip(900 + Math.random() * 1400, 0.05 + i * 0.05 + Math.random() * 0.04, 0.06, 0.05);
    }
  }

  honk(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    [0, 0.17].forEach((delay, i) => {
      for (const f of i === 0 ? [587, 740] : [659, 830]) {
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = f;
        filter.type = 'lowpass';
        filter.frequency.value = 1800;
        gain.gain.setValueAtTime(0.0001, t + delay);
        gain.gain.exponentialRampToValueAtTime(0.1, t + delay + 0.015);
        gain.gain.setValueAtTime(0.1, t + delay + 0.1);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.15);
        osc.connect(filter).connect(gain).connect(this.sfx);
        osc.start(t + delay);
        osc.stop(t + delay + 0.17);
      }
    });
  }

  tap(): void {
    this.blip(660, 0, 0.09, 0.12, 990);
  }

  star(index: number): void {
    const base = [76, 79, 84][Math.min(2, index)];
    this.bell(midi(base + 12), 0, 1.0, 0.24, this.sfx);
    this.bell(midi(base + 7), 0.02, 1.0, 0.12, this.sfx);
    this.shimmer(0.18, 0.6);
  }

  go(): void {
    this.noise(0.6, 0.12, 400, 'bandpass', 3200);
    [67, 72, 76].forEach((n, i) => this.bell(midi(n + 12), i * 0.07, 0.5, 0.14, this.sfx));
  }

  fanfare(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const notes: Array<[number, number, number]> = [
      [67, 0, 0.14], [72, 0.15, 0.14], [76, 0.3, 0.14], [79, 0.45, 0.32], [76, 0.8, 0.14], [79, 0.95, 0.7],
    ];
    for (const [n, delay, len] of notes) this.brass(midi(n), delay, len);
    this.shimmer(1.2, 1.4);
  }

  giggle(): void {
    [84, 88, 86, 91].forEach((n, i) => this.blip(midi(n), i * 0.07, 0.06, 0.05, midi(n) * 1.06));
  }

  /** Soft electric purr that follows speed. */
  setEngine(speed: number, active: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.engineOsc) {
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      filter.type = 'lowpass';
      filter.frequency.value = 380;
      gain.gain.value = 0;
      osc.connect(filter).connect(gain).connect(this.sfx);
      osc.start();
      this.engineOsc = osc;
      this.engineGain = gain;
    }
    const t = ctx.currentTime;
    this.engineOsc.frequency.setTargetAtTime(70 + speed * 5, t, 0.2);
    this.engineGain!.gain.setTargetAtTime(active ? 0.035 + Math.min(speed, 14) * 0.002 : 0, t, 0.3);
  }

  dispose(): void {
    window.clearInterval(this.schedulerTimer);
    void this.ctx?.close();
    this.ctx = null;
  }

  // ---------------------------------------------------------------------------
  // Music sequencer
  // ---------------------------------------------------------------------------

  private startSong(song: Song, resume: boolean): void {
    const ctx = this.ctx!;
    window.clearInterval(this.schedulerTimer);
    if (!song) return;
    if (!resume || this.songStart === 0) {
      this.songStart = ctx.currentTime + 0.12;
      this.nextStep = 0;
    }
    const def = SONGS[song];
    const stepDur = 60 / def.bpm / 4;
    const totalSteps = def.bars * 16;
    const schedule = () => {
      if (!this.ctx || this.song !== song) return;
      const horizon = this.ctx.currentTime + 0.25;
      while (this.songStart + this.nextStep * stepDur < horizon) {
        const t = this.songStart + this.nextStep * stepDur;
        if (t >= this.ctx.currentTime - 0.02 && this.musicOn) this.playStep(def, this.nextStep % totalSteps, t, stepDur);
        this.nextStep += 1;
      }
    };
    schedule();
    this.schedulerTimer = window.setInterval(schedule, 40);
  }

  private playStep(def: SongDef, step: number, t: number, stepDur: number): void {
    const bar = Math.floor(step / 16);
    const inBar = step % 16;
    const chord = def.chords[bar % def.chords.length];
    // Melody: music box.
    for (const [s, note, len] of def.melody) {
      if (s === step) this.bell(midi(note), t - this.ctx!.currentTime, Math.max(0.35, len * stepDur * 1.6), 0.2, this.music, true);
    }
    // Arpeggio on 8ths, softly.
    if (inBar % 2 === 0) {
      const arp = [chord[1], chord[2], chord[3], chord[2]];
      const n = arp[(inBar / 2) % arp.length] + 12;
      this.bell(midi(n), t - this.ctx!.currentTime, 0.35, 0.05, this.music, true);
    }
    // Bass on beats 1 and 3.
    if (inBar === 0 || inBar === 8) this.pluckBass(midi(chord[0]), t, stepDur * 6);
    // Pad at bar start.
    if (inBar === 0) this.pad(chord, t, stepDur * 16);
    if (def.drums) {
      if (inBar === 0 || inBar === 8) this.kick(t);
      if (inBar === 4 || inBar === 12) this.snap(t);
      if (inBar % 2 === 1) this.shaker(t, inBar % 4 === 3 ? 0.05 : 0.03);
    }
  }

  // ---------------------------------------------------------------------------
  // Instruments
  // ---------------------------------------------------------------------------

  private bell(freq: number, delay: number, dur: number, vol: number, bus: GainNode, wet = true): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + Math.max(0, delay);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const partials: Array<[number, number]> = [[1, 1], [2.0, 0.28], [3.01, 0.12], [4.2, 0.05]];
    for (const [ratio, amp] of partials) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * ratio;
      g.gain.value = amp;
      osc.connect(g).connect(gain);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
    gain.connect(bus);
    if (wet) gain.connect(this.reverbSend);
  }

  private pluckBass(freq: number, t: number, dur: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(220, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.28, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(filter).connect(gain).connect(this.music);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private pad(chord: number[], t: number, dur: number): void {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1100;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.045, t + dur * 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.05);
    filter.connect(gain).connect(this.music);
    gain.connect(this.reverbSend);
    for (const n of chord.slice(1)) {
      for (const detune of [-7, 7]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = midi(n);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(t);
        osc.stop(t + dur * 1.1);
      }
    }
  }

  private kick(t: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.14);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.42, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(gain).connect(this.music);
    osc.start(t);
    osc.stop(t + 0.22);
  }

  private snap(t: number): void {
    this.noiseAt(t, 0.09, 0.16, 2200, 'bandpass', undefined, this.music);
  }

  private shaker(t: number, vol: number): void {
    this.noiseAt(t, 0.04, vol, 7000, 'highpass', undefined, this.music);
  }

  private brass(freq: number, delay: number, len: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc2.type = 'square';
    osc.frequency.value = freq;
    osc2.frequency.value = freq * 2;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(600, t);
    filter.frequency.exponentialRampToValueAtTime(2600, t + 0.06);
    filter.frequency.exponentialRampToValueAtTime(1200, t + len);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.13, t + 0.03);
    gain.gain.setValueAtTime(0.13, t + len * 0.8);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.12);
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    osc.connect(filter);
    osc2.connect(g2).connect(filter);
    filter.connect(gain).connect(this.sfx);
    gain.connect(this.reverbSend);
    osc.start(t);
    osc2.start(t);
    osc.stop(t + len + 0.15);
    osc2.stop(t + len + 0.15);
  }

  private blip(freq: number, delay: number, dur: number, vol: number, toFreq?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (toFreq) osc.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.sfx);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private shimmer(delay: number, dur: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (let i = 0; i < 7; i += 1) {
      const n = PENTA[5 + ((i * 3) % 8)] + 24;
      this.bell(midi(n), delay + i * (dur / 9), 0.4, 0.04, this.sfx);
    }
  }

  private noise(dur: number, vol: number, freq: number, type: BiquadFilterType, toFreq?: number): void {
    if (!this.ctx) return;
    this.noiseAt(this.ctx.currentTime, dur, vol, freq, type, toFreq, this.sfx);
  }

  private noiseAt(t: number, dur: number, vol: number, freq: number, type: BiquadFilterType, toFreq: number | undefined, bus: GainNode): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (toFreq) filter.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
    filter.Q.value = type === 'bandpass' ? 1.2 : 0.7;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(bus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private makeImpulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch += 1) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.6);
      }
    }
    return buffer;
  }
}
