import React from 'react';
import ReactDOM from 'react-dom/client';
import { PillApp } from './PillApp';
import { DashboardApp } from './DashboardApp';
import './styles.css';

const params = new URLSearchParams(window.location.search);
const view = params.get('view');

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

if (view === 'dashboard') {
  root.render(
    <React.StrictMode>
      <DashboardApp />
    </React.StrictMode>
  );
} else {
  root.render(
    <React.StrictMode>
      <PillApp />
    </React.StrictMode>
  );
}
