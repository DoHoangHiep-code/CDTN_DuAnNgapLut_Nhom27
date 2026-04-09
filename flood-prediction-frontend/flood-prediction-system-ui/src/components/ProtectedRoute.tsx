import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import type { Role } from '../utils/types'

export function ProtectedRoute({ allow, children }: { allow: Role[]; children: React.ReactNode }) {
  const { user, loading, isAuthenticated } = useAuth()
  // Khi app đang hydrate profile từ token, tránh redirect sớm gây nhấp nháy UX
  if (loading) return null
  if (!isAuthenticated || !user) return <Navigate to="/login" replace />
  if (!allow.includes(user.role)) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

