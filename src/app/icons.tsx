/** Hand-drawn SVG icons. Kid UI never relies on text, so icons carry all meaning. */
import type { Area } from '../game/sim/route';

/** Area pictures for the road bar and the welcome flash. */
export function AreaIcon({ area }: { area: Area }) {
  if (area === 'meadow') {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <ellipse key={a} cx="32" cy="15" rx="10" ry="13" fill="#ff7fa6" transform={`rotate(${a} 32 32)`} />
        ))}
        <circle cx="32" cy="32" r="10" fill="#ffd84d" />
      </svg>
    );
  }
  if (area === 'forest') {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M24 34h16l3 19c.3 2-1.2 3.5-3 3.5H24c-1.800 0-3.300-1.500-3-3.500z" fill="#fff0dc" />
        <path d="M5 37C5 20 17 8 32 8s27 12 27 29c0 1.700-1.300 3-3 3H8c-1.700 0-3-1.300-3-3z" fill="#ff5a6e" />
        <circle cx="22" cy="24" r="5" fill="#fffdf8" />
        <circle cx="41" cy="20" r="4" fill="#fffdf8" />
        <circle cx="46" cy="31" r="3" fill="#fffdf8" />
      </svg>
    );
  }
  if (area === 'lake') {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M31 7v30H12z" fill="#ffb3cc" />
        <path d="M36 12v25h15z" fill="#fff6ea" />
        <path d="M9 41h46l-6 10H15z" fill="#e35a82" />
        <path d="M5 57c5-4 9-4 14 0s9 4 13 0 9-4 13 0 9 4 14 0" fill="none" stroke="#58b8ee" stroke-width="5" stroke-linecap="round" />
      </svg>
    );
  }
  return <CrownIcon />;
}

/** The time of day of a level: sun, low sun, or moon and stars. */
export function TimeIcon({ look }: { look: string }) {
  if (look === 'dusk') {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M44 50A23 23 0 1 1 33 8a19 19 0 0 0 11 42z" fill="#ffe28a" />
        <circle cx="49" cy="17" r="4" fill="#fff6d0" />
        <circle cx="55" cy="33" r="2.600" fill="#fff6d0" />
      </svg>
    );
  }
  if (look === 'golden') {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M12 42a20 20 0 0 1 40 0z" fill="#ffae3d" />
        <path d="M4 42h56" stroke="#ff7fa6" stroke-width="6" stroke-linecap="round" />
        {[-52, -26, 0, 26, 52].map((a) => (
          <path key={a} d="M32 16V8" stroke="#ffc64d" stroke-width="5" stroke-linecap="round" transform={`rotate(${a} 32 42)`} />
        ))}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <path key={a} d="M32 9v7" stroke="#ffc64d" stroke-width="5" stroke-linecap="round" transform={`rotate(${a} 32 32)`} />
      ))}
      <circle cx="32" cy="32" r="14" fill="#ffd84d" />
    </svg>
  );
}

/** A folded map with a dotted road and a heart. */
export function MapIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M6 15l17-6 18 6 17-6v40l-17 6-18-6-17 6z" fill="#c9f0c4" stroke="#fff" stroke-width="4" stroke-linejoin="round" />
      <path d="M23 9v40M41 15v40" stroke="#9fdca2" stroke-width="3" />
      <path d="M13 44c6-3 7-10 14-12s10 4 17-3" fill="none" stroke="#ff6aa9" stroke-width="4" stroke-linecap="round" stroke-dasharray="1 7" />
      <path d="M48 26c-5-4-8-6.500-8-10a4.500 4.500 0 0 1 8-2.800 4.500 4.500 0 0 1 8 2.800c0 3.500-3 6-8 10z" fill="#ff4f9e" />
    </svg>
  );
}

export function PlayIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M22 14.5c0-3 3.3-4.9 5.9-3.3l24 15.2c2.4 1.5 2.4 5 0 6.5l-24 15.2c-2.6 1.6-5.9-.3-5.9-3.3z" fill="currentColor" />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <rect x="16" y="13" width="11" height="38" rx="5" fill="currentColor" />
      <rect x="37" y="13" width="11" height="38" rx="5" fill="currentColor" />
    </svg>
  );
}

export function HomeIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 9 7 30.5c-1.6 1.4-.6 4 1.5 4H13V52c0 1.7 1.3 3 3 3h10V41h12v14h10c1.7 0 3-1.3 3-3V34.5h4.5c2.1 0 3.1-2.6 1.5-4z" fill="currentColor" />
    </svg>
  );
}

export function ReplayIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path
        d="M32 12a20 20 0 1 1-19.2 25.5"
        fill="none"
        stroke="currentColor"
        stroke-width="8"
        stroke-linecap="round"
      />
      <path d="M8 13v17h17z" fill="currentColor" stroke="currentColor" stroke-width="3" stroke-linejoin="round" />
    </svg>
  );
}

export function NextIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M14 16.5c0-2.7 3-4.4 5.3-2.9l18.6 12.6c2 1.4 2 4.4 0 5.8L19.3 44.6c-2.3 1.5-5.3-.2-5.3-2.9z" fill="currentColor" />
      <rect x="42" y="14" width="9" height="36" rx="4.5" fill="currentColor" />
    </svg>
  );
}

export function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M10 25c0-1.7 1.3-3 3-3h8l12.6-10.1c2-1.6 4.9-.2 4.9 2.3v35.6c0 2.5-2.9 3.9-4.9 2.3L21 42h-8c-1.7 0-3-1.3-3-3z" fill="currentColor" />
      {muted ? (
        <path d="m45 24 14 16m0-16L45 40" stroke="currentColor" stroke-width="6" stroke-linecap="round" />
      ) : (
        <>
          <path d="M45.5 23.5a12 12 0 0 1 0 17" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" />
          <path d="M51.5 16.5a21 21 0 0 1 0 31" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" />
        </>
      )}
    </svg>
  );
}

export function HornIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M9 27c0-2.2 1.8-4 4-4h6l24-11.5c2.7-1.3 5.8.7 5.8 3.6v33.8c0 3-3.1 4.9-5.8 3.6L19 41h-6c-2.2 0-4-1.8-4-4z" fill="currentColor" />
      <path d="M19 41l3.5 10.5c.6 1.7 2.2 2.8 4 2.8h1.2c2.2 0 3.7-2.2 3-4.3L28 44.8" fill="currentColor" />
      <circle cx="55.5" cy="20" r="3.4" fill="currentColor" />
      <circle cx="58" cy="32" r="3.4" fill="currentColor" />
      <circle cx="55.5" cy="44" r="3.4" fill="currentColor" />
    </svg>
  );
}

export function CoinIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="coin-face" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fff2a8" />
          <stop offset="0.45" stop-color="#ffd35e" />
          <stop offset="1" stop-color="#f0a02e" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="34" r="25" fill="#d9851f" />
      <circle cx="32" cy="31" r="25" fill="url(#coin-face)" />
      <circle cx="32" cy="31" r="18.5" fill="none" stroke="#e99c2c" stroke-width="3" />
      <path d="M32 42.5 22 33c-3.6-3.4-1.6-10 3.6-10 2.6 0 4.8 1.6 6.4 3.9 1.6-2.3 3.8-3.9 6.4-3.9 5.2 0 7.2 6.6 3.6 10z" fill="#ffb83d" />
      <path d="M17 20a19 19 0 0 1 12-7" stroke="#fffbe6" stroke-width="3.5" stroke-linecap="round" fill="none" />
    </svg>
  );
}

export function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="star-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff39c" />
          <stop offset="0.55" stop-color="#ffcf3f" />
          <stop offset="1" stop-color="#ff9f1c" />
        </linearGradient>
      </defs>
      <path
        d="M32 5.5c1.3 0 2.5.7 3.1 1.9l6.6 13.4 14.8 2.2c2.8.4 4 3.9 1.9 5.9L47.7 39.3l2.5 14.7c.5 2.8-2.5 5-5 3.6L32 50.6l-13.2 7c-2.5 1.4-5.5-.8-5-3.6l2.5-14.7L5.6 28.9c-2-2-.9-5.5 1.9-5.9l14.8-2.2L28.9 7.4c.6-1.2 1.8-1.9 3.1-1.9z"
        fill={filled ? 'url(#star-fill)' : 'rgba(255,255,255,0.55)'}
        stroke={filled ? '#e8891a' : 'rgba(214,99,160,0.35)'}
        stroke-width="2.5"
        stroke-linejoin="round"
      />
      {filled && <path d="M22 22.5 26 14" stroke="#fffbe0" stroke-width="3.2" stroke-linecap="round" />}
    </svg>
  );
}

export function CrownIcon() {
  return (
    <svg viewBox="0 0 64 44" aria-hidden="true">
      <defs>
        <linearGradient id="crown-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff1a6" />
          <stop offset="1" stop-color="#ffb52e" />
        </linearGradient>
      </defs>
      <path
        d="M6 14.5 18 25 29.4 6.8c1.2-1.9 4-1.9 5.2 0L46 25l12-10.5c1.8-1.6 4.6.1 4 2.5l-5.8 21.4c-.4 1.5-1.7 2.6-3.3 2.6H11.1c-1.6 0-2.9-1.1-3.3-2.6L2 17c-.6-2.4 2.2-4.1 4-2.5z"
        fill="url(#crown-fill)"
        stroke="#e39422"
        stroke-width="2.2"
        stroke-linejoin="round"
      />
      <circle cx="32" cy="29" r="4.2" fill="#ff4f9e" />
      <circle cx="17" cy="32" r="3" fill="#58d0ff" />
      <circle cx="47" cy="32" r="3" fill="#58d0ff" />
    </svg>
  );
}

export function CastleIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M10 58V30h8v-8l4-7 4 7v8h12v-8l4-7 4 7v8h8v28z" fill="#ff8cc0" stroke="#d6457f" stroke-width="3" stroke-linejoin="round" />
      <path d="M27 58V46a5 5 0 0 1 10 0v12z" fill="#b8386c" />
      <path d="M22 15V6l7 3-7 3" fill="#ffd35e" />
    </svg>
  );
}

export function CarIcon() {
  return (
    <svg viewBox="0 0 64 40" aria-hidden="true">
      <path d="M6 26c0-6 4-9 10-10l8-8c2-2 4-2 7-2h6c3 0 5 1 7 3l6 7c6 1 9 4 9 10v3c0 2-1 3-3 3H9c-2 0-3-1-3-3z" fill="#ff78ae" stroke="#d6457f" stroke-width="2.5" stroke-linejoin="round" />
      <circle cx="18" cy="31" r="6" fill="#4a3a57" stroke="#fff" stroke-width="2.5" />
      <circle cx="46" cy="31" r="6" fill="#4a3a57" stroke="#fff" stroke-width="2.5" />
      <path d="M27 9c2-1.5 3-1.5 5-1.5v8.5h-10z" fill="#bfe4ff" />
    </svg>
  );
}

export function HandIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path
        d="M26 34V13a4.5 4.5 0 0 1 9 0v16l1-8.5a4.3 4.3 0 0 1 8.5 1.3V31l1.1-5.6a4.2 4.2 0 0 1 8.3 1.4L51 43c-1.6 9-8 15-17 15h-2c-6 0-10.6-3-13.6-8l-7.3-12.2a4.3 4.3 0 0 1 7-5z"
        fill="#fff"
        stroke="#d6457f"
        stroke-width="3"
        stroke-linejoin="round"
      />
    </svg>
  );
}
