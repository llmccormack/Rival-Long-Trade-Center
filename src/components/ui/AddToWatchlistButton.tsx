'use client'
import { useState } from 'react'

export function AddToWatchlistButton({ ticker }: { ticker: string }) {
  const [status, setStatus] = useState<'idle' | 'adding' | 'done' | 'error'>('idle')

  const add = async () => {
    setStatus('adding')
    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
      })
      setStatus(res.ok ? 'done' : 'error')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'done') return <span className="text-xs text-emerald-400 font-medium">&#10003; Added to watchlist</span>

  return (
    <button
      onClick={add}
      disabled={status === 'adding'}
      className="rounded-lg border border-zinc-700 bg-zinc-900 hover:border-violet-600 hover:bg-violet-900/10 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-violet-300 transition-all disabled:opacity-50"
    >
      {status === 'adding' ? 'Adding...' : status === 'error' ? 'Error — retry' : '+ Add to Watchlist'}
    </button>
  )
}
