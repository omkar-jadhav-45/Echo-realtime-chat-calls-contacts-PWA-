// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Echo contributors
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Register service worker in production builds
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const base = (import.meta as any).env.BASE_URL || '/'
    navigator.serviceWorker.register(`${base}sw.js`).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('SW registration failed', err)
    })
  })
}
