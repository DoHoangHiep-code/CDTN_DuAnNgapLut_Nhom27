import type { DashboardResponse, FloodPredictionResponse, ReportsResponse, WeatherResponse } from '../utils/types'
import { apiV1 } from '../utils/axiosConfig'

export async function getWeather(params?: { district?: string }) {
  // Backend thật thường trả wrapper { success, data }, còn mocks trả thẳng object.
  // Lý do unwrap tại đây: tránh sửa rải rác ở nhiều page, giảm rủi ro lỗi tích hợp.
  const res = await apiV1.get<any>('/weather', { params })
  return (res.data?.data ?? res.data) as WeatherResponse
}

export async function getFloodPrediction() {
  const res = await apiV1.get<any>('/flood-prediction')
  return (res.data?.data ?? res.data) as FloodPredictionResponse
}

export async function getReports(params?: { date?: string; district?: string }) {
  const res = await apiV1.get<any>('/reports', { params })
  return (res.data?.data ?? res.data) as ReportsResponse
}

export async function getDashboard() {
  const res = await apiV1.get<any>('/dashboard')
  return (res.data?.data ?? res.data) as DashboardResponse
}

export async function exportData(_format: 'csv' | 'excel' | 'pdf', payload: unknown) {
  const res = await apiV1.post<{ ok: boolean }>('/export', payload)
  return res.data
}

export async function sendToPowerBI(payload: unknown) {
  const res = await apiV1.post<{ ok: boolean; message?: string }>('/export-powerbi', payload)
  return res.data
}

// Auth/Profile APIs (backend thật)
export async function authLogin(payload: { email: string; password: string }) {
  const res = await apiV1.post<{ success: boolean; data: { token: string; user: any } }>('/auth/login', payload)
  return res.data
}

export async function authRegister(payload: { username?: string; email: string; password: string; full_name: string }) {
  const res = await apiV1.post<{ success: boolean; message: string; data: any }>('/auth/register', payload)
  return res.data
}

export async function authForgotPassword(payload: { email: string }) {
  const res = await apiV1.post<{ success: boolean; message: string }>('/auth/forgot-password', payload)
  return res.data
}

export async function authResetPassword(payload: { token: string; newPassword: string }) {
  const res = await apiV1.post<{ success: boolean; message: string }>('/auth/reset-password', payload)
  return res.data
}

export async function getMyProfile() {
  const res = await apiV1.get<{ success: boolean; data: any }>('/users/profile')
  return res.data
}

export async function updateMyProfile(payload: { full_name: string }) {
  const res = await apiV1.put<{ success: boolean; data: any }>('/users/profile', payload)
  return res.data
}

export async function uploadMyAvatar(file: File) {
  const form = new FormData()
  form.append('avatar', file)
  const res = await apiV1.post<{ success: boolean; data: { avatar_url: string } }>('/users/profile/avatar', form, {
    // Lý do set multipart: để backend multer đọc được file và giới hạn/validate
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

// Admin User Management APIs (admin-only)
export async function adminListUsers(params?: { q?: string; role?: 'all' | 'admin' | 'expert' | 'user' }) {
  // Lý do unwrap: backend chuẩn hoá { success, data }, còn UI cần data thuần để render table
  const res = await apiV1.get<any>('/admin/users', { params })
  return res.data?.data ?? res.data
}

export async function adminCreateUser(payload: {
  username: string
  email: string
  password: string
  full_name: string
  role: 'admin' | 'expert' | 'user'
}) {
  const res = await apiV1.post<any>('/admin/users', payload)
  return res.data?.data ?? res.data
}

export async function adminUpdateUser(
  userId: number,
  patch: { username?: string; email?: string; password?: string; full_name?: string; role?: 'admin' | 'expert' | 'user' },
) {
  const res = await apiV1.put<any>(`/admin/users/${userId}`, patch)
  return res.data?.data ?? res.data
}

export async function adminDeleteUser(userId: number) {
  const res = await apiV1.delete<any>(`/admin/users/${userId}`)
  return res.data
}

