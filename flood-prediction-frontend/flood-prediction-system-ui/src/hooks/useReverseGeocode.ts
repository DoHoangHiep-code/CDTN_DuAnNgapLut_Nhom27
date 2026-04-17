import { useEffect, useState } from 'react'

const cache = new Map<string, string>()

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`
  if (cache.has(key)) return cache.get(key)!

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=vi`,
      { headers: { 'User-Agent': 'FloodPredictionSystem/1.0' } },
    )
    if (!res.ok) throw new Error()
    const data = await res.json()
    const addr = data.address ?? {}
    // Ưu tiên: suburb → quarter → city_district → county → city
    const placeName = addr.suburb ?? addr.quarter ?? addr.city_district ?? addr.county ?? addr.city
    const name = placeName
      ? `${placeName} (${lat.toFixed(4)}, ${lng.toFixed(4)})`
      : `${lat.toFixed(4)}, ${lng.toFixed(4)}`
    cache.set(key, name)
    return name
  } catch {
    const fallback = `${lat.toFixed(4)}, ${lng.toFixed(4)}`
    cache.set(key, fallback)
    return fallback
  }
}

// Trả về map từ "lat,lng" → tên khu vực, fetch tuần tự để tránh rate-limit Nominatim
export function useReverseGeocode(coords: { lat: number; lng: number }[]) {
  const [locationMap, setLocationMap] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    if (!coords.length) return
    let cancelled = false

    async function fetchAll() {
      for (const { lat, lng } of coords) {
        if (cancelled) break
        const key = `${lat.toFixed(5)},${lng.toFixed(5)}`
        if (!cache.has(key)) {
          await reverseGeocode(lat, lng)
          // 1 giây delay giữa các request để tuân thủ rate-limit Nominatim (1 req/s)
          await new Promise((r) => setTimeout(r, 1100))
        }
        if (!cancelled) {
          setLocationMap(new Map(cache))
        }
      }
    }

    fetchAll()
    return () => { cancelled = true }
  }, [JSON.stringify(coords)])

  function getLocation(lat: number, lng: number): string {
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`
    return locationMap.get(key) ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`
  }

  return { getLocation }
}
