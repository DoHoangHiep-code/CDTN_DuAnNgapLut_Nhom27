import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './components/ProtectedRoute'
import { MainLayout } from './layouts/MainLayout'
import { useAuth } from './context/AuthContext'
import { DashboardPage } from './pages/DashboardPage'
import { MapPage } from './pages/MapPage'
import { WeatherPage } from './pages/WeatherPage'
import { ReportsPage } from './pages/ReportsPage'
import { SettingsPage } from './pages/SettingsPage'
import { ProfilePage } from './pages/ProfilePage'
import { LoginPage } from './pages/LoginPage'

export function App() {
  const { user } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/"
        element={
          user ? (
            <MainLayout />
          ) : (
            // Keep the app simple: landing goes to login when unauthenticated.
            <Navigate to="/login" replace />
          )
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="map" element={<MapPage />} />
        <Route path="flood-map" element={<MapPage />} />
        <Route path="weather" element={<WeatherPage />} />

        <Route
          path="reports"
          element={
            <ProtectedRoute allow={['expert', 'admin']}>
              <ReportsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="settings"
          element={
            <ProtectedRoute allow={['admin']}>
              <SettingsPage />
            </ProtectedRoute>
          }
        />
        <Route path="profile" element={<ProfilePage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

