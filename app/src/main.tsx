import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { appUpdater, setUpdateAction } from './lib/appUpdate'

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh: () => appUpdater.onNeedRefresh(),
  // O iPhone quase não procura versão nova sozinho; procura toda vez que o app volta para a frente.
  onRegisteredSW: (_url, registration) => {
    if (!registration) return
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void registration.update()
    })
  },
})
setUpdateAction(() => void updateSW(true))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
