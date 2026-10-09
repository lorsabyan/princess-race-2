/** Hand-drawn SVG icons. Kid UI never relies on text, so icons carry all meaning. */

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
