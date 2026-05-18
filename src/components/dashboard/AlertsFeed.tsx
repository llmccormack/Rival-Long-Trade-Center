'use client'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import type { Alert } from '@/types'

export function AlertsFeed() {
  const [alerts, setAlerts] = useState<Alert[]>([])

  useEffect(() => {
    fetch('/api/alerts')
      .then((r) => r.json())
      .then(setAlerts)
      .catch(() => {})
  }, [])

  const markRead = async (id: string) => {
    await fetch('/api/alerts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, isRead: true } : a)))
  }

  const unread = alerts.filter((a) => !a.isRead)

  return (
    <div className="rounded border border-zinc-800 bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <span className="text-sm font-medium text-zinc-300">Alerts</span>
        {unread.length > 0 && (
          <span className="rounded-full bg-emerald-900 px-2 py-0.5 text-xs text-emerald-400">
            {unread.length} new
          </span>
        )}
      </div>
      <div className="max-h-72 overflow-y-auto divide-y divide-zinc-800">
        {alerts.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-zinc-600">No alerts</p>
        )}
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className={cn(
              'flex items-start gap-3 px-4 py-3 transition-colors',
              !alert.isRead && 'bg-zinc-800/50',
              'cursor-pointer hover:bg-zinc-800'
            )}
            onClick={() => markRead(alert.id)}
          >
            <span
              className={cn(
                'mt-0.5 h-2 w-2 shrink-0 rounded-full',
                alert.severity === 'buy' && 'bg-emerald-400',
                alert.severity === 'warning' && 'bg-yellow-400',
                alert.severity === 'info' && 'bg-zinc-500'
              )}
            />
            <div className="min-w-0">
              <p className="text-xs text-zinc-300">{alert.message}</p>
              <p className="mt-0.5 text-xs text-zinc-600">
                {new Date(alert.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
