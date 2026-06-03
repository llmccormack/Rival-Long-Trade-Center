'use client'
import { useEffect } from 'react'

export function KeepAlive() {
  useEffect(() => {
    // Ping every 10 minutes to prevent Railway container sleep
    const interval = setInterval(() => {
      fetch('/api/health').catch(() => {})
    }, 10 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])
  return null
}
