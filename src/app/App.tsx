import { useEffect, useRef, useState } from 'preact/hooks';
import type { Game } from '../game/Game';
import { ui } from './state';
import {
  CarIcon,
  CastleIcon,
  CoinIcon,
  CrownIcon,
  HandIcon,
  HomeIcon,
  HornIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  ReplayIcon,
  SoundIcon,
  StarIcon,
  AreaIcon,
} from './icons';

interface Props {
  game: Game;
}

/** Big round candy button. `size` in px. */
function RoundButton(props: {
  label: string;
  onPress: () => void;
  size?: number;
  tone?: 'pink' | 'white' | 'gold' | 'mint';
  children: preact.ComponentChildren;
  className?: string;
}) {
  const { label, onPress, size = 72, tone = 'pink', children, className = '' } = props;
  return (
    <button
      type="button"
      aria-label={label}
      class={`round-btn tone-${tone} ${className}`}
      style={{ '--size': `${size}px` }}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        onPress();
      }}
    >
      <span class="round-btn-icon">{children}</span>
    </button>
  );
}

function Loading() {
  const p = ui.loadProgress.value;
  return (
    <div class="screen loading-screen">
      <div class="loading-crown">
        <CrownIcon />
      </div>
      <div class="loading-track" role="progressbar" aria-valuenow={Math.round(p * 100)}>
        <div class="loading-fill" style={{ width: `${Math.round(p * 100)}%` }} />
      </div>
    </div>
  );
}

function Title({ game }: Props) {
  return (
    <div class="screen title-screen">
      <div class="logo" aria-label="Princess Race 3">
        <div class="logo-crown">
          <CrownIcon />
        </div>
        <div class="logo-princess">Princess</div>
        <div class="logo-sub">Race 3</div>
      </div>
      <RoundButton label="Play" size={128} className="play-btn pulse" onPress={() => game.play()}>
        <PlayIcon />
      </RoundButton>
      <div class="corner corner-br">
        <RoundButton label={ui.muted.value ? 'Sound on' : 'Sound off'} size={58} tone="white" onPress={() => game.toggleMute()}>
          <SoundIcon muted={ui.muted.value} />
        </RoundButton>
      </div>
      <LevelDots />
    </div>
  );
}

function LevelDots() {
  const level = ui.level.value;
  const best = ui.bestStars.value;
  const count = Math.max(5, level + 1);
  return (
    <div class="level-dots" aria-hidden="true">
      {Array.from({ length: Math.min(count, 10) }, (_, i) => i + 1).map((n) => (
        <span key={n} class={`level-dot ${n === level ? 'current' : ''} ${best[n] ? 'done' : ''}`}>
          {best[n] ? '★' : ''}
        </span>
      ))}
    </div>
  );
}

function CoinCounter() {
  const pulse = ui.coinPulse.value;
  const [bump, setBump] = useState(false);
  useEffect(() => {
    if (pulse === 0) return;
    setBump(true);
    const id = window.setTimeout(() => setBump(false), 160);
    return () => window.clearTimeout(id);
  }, [pulse]);
  return (
    <div class={`hud-pill coin-pill ${bump ? 'bump' : ''}`}>
      <span class="coin-icon">
        <CoinIcon />
      </span>
      <span class="coin-count">{ui.coins.value}</span>
    </div>
  );
}

function ProgressRoad() {
  const p = ui.progress.value;
  return (
    <div class="hud-pill progress-pill" aria-hidden="true">
      <span class="progress-home">
        <HomeIcon />
      </span>
      <div class="progress-track">
        <div class="progress-fill" style={{ width: `${p * 100}%` }} />
        {ui.areaMarks.value.map((m) => (
          <span key={m.area} class={`progress-mark ${p >= m.at ? 'reached' : ''}`} style={{ left: `${m.at * 100}%` }}>
            <AreaIcon area={m.area} />
          </span>
        ))}
        <div class="progress-car" style={{ left: `${p * 100}%` }}>
          <CarIcon />
        </div>
      </div>
      <span class="progress-castle">
        <CastleIcon />
      </span>
    </div>
  );
}

/** A big picture of the area just entered, for little ones who can't read a sign. */
function AreaFlash() {
  const pulse = ui.areaPulse.value;
  const area = ui.areaFlash.value;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (pulse === 0) return;
    setShown(true);
    const id = window.setTimeout(() => setShown(false), 1500);
    return () => window.clearTimeout(id);
  }, [pulse]);
  if (!shown || !area) return null;
  return (
    <div key={pulse} class="area-flash" aria-hidden="true">
      <AreaIcon area={area} />
    </div>
  );
}

function Hud({ game }: Props) {
  const flash = ui.gemFlash.value;
  return (
    <div class="screen hud">
      <div class="hud-top">
        <CoinCounter />
        <ProgressRoad />
        <RoundButton label="Pause" size={60} tone="white" onPress={() => game.setPaused(true)}>
          <PauseIcon />
        </RoundButton>
      </div>
      <div class="corner corner-br horn">
        <RoundButton label="Horn" size={84} tone="gold" onPress={() => game.honk()}>
          <HornIcon />
        </RoundButton>
      </div>
      {ui.showSteerHint.value && (
        <div class="steer-hint" aria-hidden="true">
          <div class="steer-arrows">
            <span>‹</span>
            <span>›</span>
          </div>
          <div class="steer-hand">
            <HandIcon />
          </div>
        </div>
      )}
      {flash > 0 && <div key={flash} class="gem-flash" />}
      <AreaFlash />
    </div>
  );
}

function PauseMenu({ game }: Props) {
  return (
    <div class="screen overlay pause-overlay">
      <div class="card pause-card">
        <RoundButton label="Continue" size={120} className="pulse" onPress={() => game.setPaused(false)}>
          <PlayIcon />
        </RoundButton>
        <div class="card-row">
          <RoundButton label="Start again" size={72} tone="white" onPress={() => void game.restart()}>
            <ReplayIcon />
          </RoundButton>
          <RoundButton label="Home" size={72} tone="white" onPress={() => game.goHome()}>
            <HomeIcon />
          </RoundButton>
          <RoundButton label={ui.muted.value ? 'Sound on' : 'Sound off'} size={72} tone="white" onPress={() => game.toggleMute()}>
            <SoundIcon muted={ui.muted.value} />
          </RoundButton>
        </div>
      </div>
    </div>
  );
}

function Results({ game }: Props) {
  const stars = ui.stars.value;
  const [shown, setShown] = useState(0);
  const [count, setCount] = useState(0);
  const target = ui.coins.value;
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const timers: number[] = [];
    for (let i = 0; i < stars; i += 1) {
      timers.push(
        window.setTimeout(() => {
          setShown(i + 1);
          game.audio.star(i);
        }, 650 + i * 520),
      );
    }
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / 1100);
      setCount(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div class="screen overlay results-overlay">
      <div class="card results-card">
        <div class="stars-row">
          {[0, 1, 2].map((i) => (
            <span key={i} class={`result-star star-${i} ${i < shown ? 'on' : ''}`}>
              <StarIcon filled={i < shown} />
            </span>
          ))}
        </div>
        <div class="results-coins">
          <span class="coin-icon big">
            <CoinIcon />
          </span>
          <span class="results-count">{count}</span>
        </div>
        <div class="card-row">
          <RoundButton label="Home" size={70} tone="white" onPress={() => game.goHome()}>
            <HomeIcon />
          </RoundButton>
          <RoundButton label="Play again" size={70} tone="white" onPress={() => void game.restart()}>
            <ReplayIcon />
          </RoundButton>
          <RoundButton label="Next level" size={104} tone="mint" className="pulse" onPress={() => void game.nextLevel()}>
            <NextIcon />
          </RoundButton>
        </div>
      </div>
    </div>
  );
}

function IntroSkip({ game }: Props) {
  return <div class="screen intro-skip" onPointerDown={() => game.skipIntro()} />;
}

/** `?debug` overlay: frame rate and renderer cost, for checking real devices. */
function DebugStats() {
  const [text, setText] = useState('');
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = window.__GAME__?.stats() as { renderer?: { fps: number; calls: number; triangles: number; tier: string; dpr: number } } | undefined;
      const r = s?.renderer;
      if (r) setText(`${r.fps} fps · ${r.calls} calls · ${(r.triangles / 1000).toFixed(0)}k tris · ${r.tier} · dpr ${r.dpr.toFixed(2)}`);
    }, 500);
    return () => window.clearInterval(id);
  }, []);
  return <div class="debug-stats">{text}</div>;
}

const showDebug = new URLSearchParams(location.search).has('debug');

export function App({ game }: Props) {
  const screen = ui.screen.value;
  const paused = ui.paused.value;
  return (
    <div class={`ui-root screen-${screen}`}>
      {screen === 'loading' && <Loading />}
      {screen === 'title' && <Title game={game} />}
      {screen === 'intro' && <IntroSkip game={game} />}
      {screen === 'play' && !paused && <Hud game={game} />}
      {screen === 'finish' && (
        <div class="screen hud">
          <div class="hud-top">
            <CoinCounter />
          </div>
        </div>
      )}
      {screen === 'results' && <Results game={game} />}
      {paused && <PauseMenu game={game} />}
      {showDebug && <DebugStats />}
    </div>
  );
}
