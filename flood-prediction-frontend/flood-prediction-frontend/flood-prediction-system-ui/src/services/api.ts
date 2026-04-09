import axios from 'axios'
import type { FloodPredictionResponse, ReportsResponse, WeatherResponse } from '../utils/types'

const SETTINGS_KEY = 'fps_settings_v1'
const AUTH_KEY = 'fps_mock_jwt'

function getApiBaseUrlFromStorage(): string {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return ''
    const parsed = JSON.parse(raw) as { apiBaseUrl?: string }
    return typeof parsed.apiBaseUrl === 'string' ? parsed.apiBaseUrl : ''
  } catch {
    return ''
  }
}

function getTokenFromStorage(): string | null {
  try {
    return localStorage.getItem(AUTH_KEY)
  } catch {
    return null
  }
}

export const api = axios.create({
  baseURL: '',
  timeout: 15000,
})

api.interceptors.request.use((config) => {
  const baseURL = getApiBaseUrlFromStorage()
  config.baseURL = baseURL || ''
  const token = getTokenFromStorage()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export async function getWeather(params?: { district?: string }) {
  const res = await api.get<WeatherResponse>('/api/weather', { params })
  return res.data
}

export async function getFloodPrediction() {
  const res = await api.get<FloodPredictionResponse>('/api/flood-prediction')
  return res.data
}

export async function getReports(params?: { date?: string; district?: string }) {
  const res = await api.get<ReportsResponse>('/api/reports', { params })
  return res.data
}

export async function exportData(_format: 'csv' | 'excel' | 'pdf', payload: unknown) {
  const res = await api.post<{ ok: boolean }>('/api/export', payload)
  return res.data
}

export async function sendToPowerBI(payload: unknown) {
  const res = await api.post<{ ok: boolean; message?: string }>('/api/export-powerbi', payload)
  return res.data
}

