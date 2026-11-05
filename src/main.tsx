import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { useAppStore } from './state/useAppStore';
import './styles/index.css';

if (import.meta.env.DEV) {
  (window as unknown as { __app: typeof useAppStore }).__app = useAppStore;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
