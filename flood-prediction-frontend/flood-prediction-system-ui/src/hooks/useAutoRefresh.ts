import { useEffect, useRef } from 'react'
import { useSettings } from '../context/SettingsContext'

/**
 * Hook to automatically trigger a callback based on the user's refresh interval setting.
 * @param callback The function to execute on each interval tick (e.g. reload data)
 */
export function useAutoRefresh(callback: () => void) {
  const { forecastRefreshInterval } = useSettings()
  
  // Use a ref to store the latest callback without re-triggering the effect
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    // If the interval is set to 0 (Tắt), we don't set up the timer
    if (forecastRefreshInterval === 0) return

    // Convert minutes to milliseconds
    const ms = forecastRefreshInterval * 60 * 1000

    const intervalId = setInterval(() => {
      callbackRef.current()
    }, ms)

    // Cleanup interval on unmount or when the setting changes
    return () => clearInterval(intervalId)
  }, [forecastRefreshInterval])
}
