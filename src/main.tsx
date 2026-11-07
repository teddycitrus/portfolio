import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { useAppStore } from './state/useAppStore';
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/jetbrains-mono';
import './styles/index.css';
import { inject } from '@vercel/analytics';
import { initDrone } from './audio/drone';

initDrone();
// cookieless page views (Vercel Web Analytics), on the deployed site only
if (import.meta.env.PROD) inject();

if (import.meta.env.DEV) {
  (window as unknown as { __app: typeof useAppStore }).__app = useAppStore;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
