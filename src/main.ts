import './styles.css';
import { App } from './app';

const app = new App();
// Exposed in development builds only, for debugging from the browser console.
if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = app;
