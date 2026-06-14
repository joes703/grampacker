import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { runServiceWorkerTeardown } from './lib/sw-teardown'

// One-time cleanup of the removed service worker / PWA caches for returning
// users. Fire-and-forget: it never rejects (all steps are wrapped) and must
// not block first paint.
void runServiceWorkerTeardown()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
