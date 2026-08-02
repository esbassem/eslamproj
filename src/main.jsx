import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/styles/index.css';
import { AppProviders } from '@/app/providers/AppProviders';
import { AppRouter } from '@/app/router/AppRouter';
import { AppUpdateBanner } from '@/core/components/AppUpdateBanner';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppProviders>
      <AppUpdateBanner />
      <AppRouter />
    </AppProviders>
  </React.StrictMode>,
);

