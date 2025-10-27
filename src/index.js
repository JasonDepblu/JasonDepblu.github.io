import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// Add debugging
console.log('React script loaded, looking for #root element');

// Wait for DOM to be ready
window.addEventListener('DOMContentLoaded', () => {
  const rootElement = document.getElementById('root');
  console.log('Root element found:', rootElement);

  if (rootElement) {
    try {
      const root = createRoot(rootElement);
      root.render(
        <React.StrictMode>
          <App />
        </React.StrictMode>
      );
      console.log('React app successfully rendered to #root');
    } catch(error) {
      console.error('Error rendering React app:', error);
    }
  } else {
    console.error('Could not find #root element to mount React app');
  }
});