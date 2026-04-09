import type { Role } from './types'
import type { ComponentType } from 'react'
import {
  BarChart3,
  MapPinned,
  CloudSun,
  FileText,
  Settings,
  UserCircle2,
  LayoutDashboard,
} from 'lucide-react'

export type NavItem = {
  key: string
  labelKey: string
  to: string
  roles: Role[]
  icon: ComponentType<{ className?: string }>
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', labelKey: 'nav.dashboard', to: '/', roles: ['user', 'expert', 'admin'], icon: LayoutDashboard },
  { key: 'map', labelKey: 'nav.map', to: '/map', roles: ['user', 'expert', 'admin'], icon: MapPinned },
  { key: 'weather', labelKey: 'nav.weather', to: '/weather', roles: ['user', 'expert', 'admin'], icon: CloudSun },
  { key: 'reports', labelKey: 'nav.reports', to: '/reports', roles: ['expert', 'admin'], icon: FileText },
  { key: 'settings', labelKey: 'nav.settings', to: '/settings', roles: ['admin'], icon: Settings },
  { key: 'profile', labelKey: 'nav.profile', to: '/profile', roles: ['user', 'expert', 'admin'], icon: UserCircle2 },
]

export const BRAND_ICON = BarChart3

