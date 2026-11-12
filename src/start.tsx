import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { useAppStore } from './state/useAppStore';
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/cinzel/latin-600.css';
import '@fontsource/noto-sans-runic/runic-400.css';
import './styles/index.css';
import { inject } from '@vercel/analytics';
import { initDrone } from './audio/drone';
import { preloadAssets } from './ui/preloadAssets';
import { startBaked } from './scenes/overworld/bakedMaps';
import { startQuality } from './scenes/gpuTier';

// fonts and video posters start now, alongside the scene; the loader waits for both
preloadAssets();
// the shipped sky and planet maps unpack in a worker while the app starts (see bakedMaps)
if (startQuality !== 'none') void startBaked();
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
