import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import 'leaflet/dist/leaflet.css'

import './styles/index.css'
import './i18n/i18n'
import { App } from './App'
import { AuthProvider } from './context/AuthContext'
import { SettingsProvider } from './context/SettingsContext'
import { setupDevMocks } from './mocks/setupDevMocks'
import { ErrorBoundary } from './components/ErrorBoundary'

setupDevMocks()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <SettingsProvider>
        <AuthProvider>
          <BrowserRouter>
            <App />
            <Toaster position="top-right" />
          </BrowserRouter>
        </AuthProvider>
      </SettingsProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)

