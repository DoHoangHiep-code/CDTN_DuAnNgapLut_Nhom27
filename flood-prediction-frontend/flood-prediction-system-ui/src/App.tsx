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
import { AiMonitorLogs } from './pages/AiMonitorLogs'
import { RegisterPage } from './pages/RegisterPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { UserManagementPage } from './pages/UserManagementPage'

export function App() {
  const { isAuthenticated, loading } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route
        path="/"
        element={
          !loading && isAuthenticated ? (
            <MainLayout />
          ) : (
            // Keep the app simple: landing goes to login when unauthenticated.
            <Navigate to="/login" replace />
          )
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route
          path="dashboard"
          element={
            <ProtectedRoute allow={['user', 'expert', 'admin']}>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="map"
          element={
            <ProtectedRoute allow={['user', 'expert', 'admin']}>
              <MapPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="flood-map"
          element={
            <ProtectedRoute allow={['user', 'expert', 'admin']}>
              <MapPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="weather"
          element={
            <ProtectedRoute allow={['user', 'expert', 'admin']}>
              <WeatherPage />
            </ProtectedRoute>
          }
        />

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
        <Route
          path="admin/users"
          element={
            <ProtectedRoute allow={['admin']}>
              <UserManagementPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="profile"
          element={
            <ProtectedRoute allow={['user', 'expert', 'admin']}>
              <ProfilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="logs"
          element={
            <ProtectedRoute allow={['admin']}>
              <AiMonitorLogs />
            </ProtectedRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

