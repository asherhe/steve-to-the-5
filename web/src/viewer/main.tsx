import { createRoot } from 'react-dom/client';
import { App } from './App';
const root = document.getElementById('root');
if (!root) throw new Error('Viewer root is missing.');
const app = createRoot(root);
if (import.meta.env.DEV && new URLSearchParams(location.search).get('fixtures') === '1') {
  const { FixtureHarness } = await import('./harness/main');
  app.render(<FixtureHarness />);
} else {
  app.render(<App />);
}
