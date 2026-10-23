import { render } from 'preact';
import '@fontsource-variable/fraunces';
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/500.css';
import '@fontsource/hanken-grotesk/600.css';
import '@fontsource/jetbrains-mono/400.css';
import './ui/tokens.css';
import './ui/app.css';
import { App } from './app/App.tsx';

const root = document.getElementById('app');
if (root) render(<App />, root);
