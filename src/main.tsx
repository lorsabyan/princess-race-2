import '@fontsource-variable/fredoka';
import './app/styles.css';
import { render } from 'preact';
import { App } from './app/App';
import { Game } from './game/Game';

const canvas = document.querySelector<HTMLCanvasElement>('#stage');
const root = document.querySelector<HTMLElement>('#ui');
if (!canvas || !root) throw new Error('Missing #stage or #ui');

const game = new Game(canvas);
render(<App game={game} />, root);

game.init().catch((error) => {
  console.error(error);
  root.innerHTML = `<pre style="position:fixed;inset:auto 12px 12px;color:#b8246a;white-space:pre-wrap">${String(error)}</pre>`;
});

// Block pinch-zoom / double-tap zoom gestures (iOS ignores user-scalable=no).
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.dispose();
    render(null, root);
  });
}
