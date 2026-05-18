'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTradingMode } from '@/contexts/TradingMode'
import { cn } from '@/lib/utils'

interface Config {
  isEnabled: boolean
  mode: string
  minPhilosophyScore: number
  minMarginOfSafety: number
  maxPositionPct: number
  schwabAccountId: string | null
  lastRunAt: string | null
}

interface Health {
  status: string
  db: boolean
  fmp: boolean
  schwab: boolean
  ts: string
}

const StatusDot = ({ ok }: { ok: boolean }) => (
  <span className={cn('inline-flex h-2 w-2 rounded-full', ok ? 'bg-emerald-500' : 'bg-red-500')} />
)

function NotifyTestButton() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle')
  const test = async () => {
    setStatus('sending')
    const res = await fetch('/api/notifications/test', { method: 'POST' })
    const data = await res.json()
    setStatus(data.ok ? 'ok' : 'error')
    setTimeout(() => setStatus('idle'), 3000)
  }
  return (
    <button onClick={test} disabled={status === 'sending'}
      className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-400 hover:border-zinc-500 disabled:opacity-40 transition-colors">
      {status === 'sending' ? 'Sending…' : status === 'ok' ? '✓ Test email sent' : status === 'error' ? '✗ Failed' : 'Send test email'}
    </button>
  )
}

function SchwabBanner() {
  const searchParams = useSearchParams()
  const schwabStatus = searchParams.get('schwab')
  if (!schwabStatus) return null
  return (
    <>
      {schwabStatus === 'connected' && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-800/50 bg-emerald-900/15 px-4 py-3 text-sm text-emerald-400">
          <StatusDot ok={true} />
          Schwab account connected successfully.
        </div>
      )}
      {schwabStatus === 'error' && (
        <div className="flex items-center gap-2 rounded-xl border border-red-800/50 bg-red-900/15 px-4 py-3 text-sm text-red-400">
          <StatusDot ok={false} />
          Schwab connection failed: {searchParams.get('reason') ?? 'Unknown error'}
        </div>
      )}
    </>
  )
}

export default function SettingsPage() {
  const { mode, setMode } = useTradingMode()
  const [config, setConfig] = useState<Config | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<any>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/autopilot/config').then(r => r.json()).catch(() => null),
      fetch('/api/health').then(r => r.json()).catch(() => null),
    ]).then(([cfg, hlth]) => {
      if (cfg && !cfg.error) setConfig(cfg)
      if (hlth) setHealth(hlth)
    })
  }, [])

  const save = async () => {
    if (!config) return
    setSaving(true)
    try {
      const res = await fetch('/api/autopilot/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isEnabled: config.isEnabled,
          mode: config.mode,
          minPhilosophyScore: config.minPhilosophyScore,
          minMarginOfSafety: config.minMarginOfSafety,
          maxPositionPct: config.maxPositionPct,
        }),
      })
      const updated = await res.json()
      setConfig(updated)
      setMode(updated.mode)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const runNow = async () => {
    setRunning(true)
    setRunResult(null)
    try {
      const res = await fetch('/api/autopilot/run', { method: 'POST' })
      const result = await res.json()
      setRunResult(result)
    } finally {
      setRunning(false)
    }
  }

  const connectSchwab = () => {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.NEXT_PUBLIC_SCHWAB_CLIENT_ID ?? '',
      redirect_uri: `${window.location.origin}/api/schwab/callback`,
      scope: 'readonly trading',
    })
    window.location.href = `https://api.schwabapi.com/v1/oauth/authorize?${params}`
  }

  const StatusDot = ({ ok }: { ok: boolean }) => (
    <span className={cn('inline-flex h-2 w-2 rounded-full', ok ? 'bg-emerald-500' : 'bg-red-500')} />
  )

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Settings</h1>
        <p className="mt-0.5 text-sm text-zinc-500">Autopilot configuration, API connections, and system status.</p>
      </div>

      <Suspense fallback={null}>
        <SchwabBanner />
      </Suspense>

      {/* System health */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-zinc-500">System Status</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Database', ok: health?.db },
            { label: 'FMP API', ok: health?.fmp },
            { label: 'Schwab API', ok: health?.schwab },
            { label: 'App Server', ok: !!health },
          ].map(({ label, ok }) => (
            <div key={label} className={cn(
              'rounded-lg border p-3',
              ok ? 'border-emerald-900/50 bg-emerald-900/10' : 'border-zinc-800 bg-zinc-950/40'
            )}>
              <div className="flex items-center gap-2 mb-1">
                <StatusDot ok={!!ok} />
                <span className="text-xs font-medium text-zinc-400">{label}</span>
              </div>
              <div className={cn('text-xs', ok ? 'text-emerald-500' : 'text-zinc-600')}>
                {ok == null ? 'Checking…' : ok ? 'Connected' : 'Not configured'}
              </div>
            </div>
          ))}
        </div>
        {health?.ts && (
          <p className="mt-3 text-[10px] text-zinc-700">Last checked: {new Date(health.ts).toLocaleTimeString()}</p>
        )}
      </div>

      {/* Schwab connection */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h2 className="mb-1 text-xs font-medium uppercase tracking-widest text-zinc-500">Schwab Brokerage</h2>
        <p className="mb-4 text-xs text-zinc-600">Required for live trading. Paper mode works without a connection.</p>

        {health?.schwab ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <StatusDot ok={true} />
              <span className="text-sm text-zinc-300">OAuth credentials configured</span>
            </div>
            <button
              onClick={connectSchwab}
              className="rounded-lg border border-violet-700/50 bg-violet-900/20 px-4 py-2 text-sm font-medium text-violet-400 hover:bg-violet-900/30 transition-colors"
            >
              {config?.schwabAccountId ? 'Reconnect Account' : 'Connect Schwab Account'}
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-amber-800/40 bg-amber-900/10 p-4">
            <p className="text-sm text-amber-400/80 mb-2">
              Add <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs">SCHWAB_CLIENT_ID</code> and{' '}
              <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs">SCHWAB_CLIENT_SECRET</code> to your environment variables to enable live trading.
            </p>
            <a
              href="https://developer.schwab.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-amber-500 hover:underline"
            >
              Get credentials at developer.schwab.com →
            </a>
          </div>
        )}
      </div>

      {/* Autopilot config */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-zinc-500">Autopilot Configuration</h2>

        {!config ? (
          <div className="h-40 animate-pulse rounded-lg bg-zinc-800" />
        ) : (
          <div className="space-y-5">
            {/* Enable / Mode */}
            <div className="flex flex-wrap gap-4">
              <div>
                <div className="mb-1.5 text-xs text-zinc-500">Autopilot</div>
                <button
                  onClick={() => setConfig({ ...config, isEnabled: !config.isEnabled })}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-all',
                    config.isEnabled
                      ? 'border-emerald-800/60 bg-emerald-900/20 text-emerald-400'
                      : 'border-zinc-700 bg-zinc-900 text-zinc-500'
                  )}
                >
                  <span className={cn('h-2 w-2 rounded-full', config.isEnabled ? 'bg-emerald-500' : 'bg-zinc-600')} />
                  {config.isEnabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
              <div>
                <div className="mb-1.5 text-xs text-zinc-500">Trading Mode</div>
                <div className="flex rounded-lg bg-zinc-900 border border-zinc-800 p-0.5">
                  {(['paper', 'live'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setConfig({ ...config, mode: m })}
                      className={cn(
                        'rounded-md px-4 py-1.5 text-xs font-semibold tracking-wide transition-all uppercase',
                        config.mode === m
                          ? m === 'paper' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'text-zinc-600 hover:text-zinc-400'
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {config.mode === 'live' && (
              <div className="rounded-lg border border-amber-800/40 bg-amber-900/10 px-4 py-3 text-xs text-amber-400/80">
                ⚠ Live mode places real orders through your Schwab account. Ensure your account is connected above before enabling.
              </div>
            )}

            {/* Sliders */}
            {[
              { key: 'minPhilosophyScore' as const, label: 'Min Philosophy Score', min: 40, max: 80, step: 1, unit: '/ 100', color: 'violet' },
              { key: 'minMarginOfSafety' as const, label: 'Min Margin of Safety', min: 15, max: 50, step: 1, unit: '%', color: 'emerald' },
              { key: 'maxPositionPct' as const, label: 'Max Position Size', min: 5, max: 15, step: 1, unit: '% of portfolio', color: 'blue' },
            ].map(({ key, label, min, max, step, unit, color }) => (
              <div key={key}>
                <div className="flex justify-between mb-1.5">
                  <label className="text-sm text-zinc-400">{label}</label>
                  <span className={cn('text-sm font-mono font-bold', `text-${color}-400`)}>
                    {config[key]}{unit}
                  </span>
                </div>
                <input
                  type="range" min={min} max={max} step={step} value={config[key]}
                  onChange={e => setConfig({ ...config, [key]: Number(e.target.value) })}
                  className={cn('w-full', `accent-${color}-600`)}
                />
                <div className="flex justify-between mt-1 text-[10px] text-zinc-700">
                  <span>Permissive ({min}{unit.startsWith('%') || unit === '/ 100' ? unit.replace('/ 100', '') : ''})</span>
                  <span>Strict ({max}{unit.startsWith('%') || unit === '/ 100' ? unit.replace('/ 100', '') : ''})</span>
                </div>
              </div>
            ))}

            {config.lastRunAt && (
              <p className="text-xs text-zinc-600">
                Last run: {new Date(config.lastRunAt).toLocaleString()}
              </p>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={save}
                disabled={saving}
                className="rounded-lg bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-40 transition-colors"
              >
                {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Configuration'}
              </button>
              <button
                onClick={runNow}
                disabled={running}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-5 py-2 text-sm font-medium text-zinc-300 hover:border-zinc-500 disabled:opacity-40 transition-colors"
              >
                {running ? 'Running…' : 'Run Now'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Run result */}
      {runResult && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-zinc-500">Last Run Result</h2>
          {runResult.skipped ? (
            <p className="text-sm text-zinc-500">{runResult.reason}</p>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-4 text-xs text-zinc-500">
                <span><span className="font-mono text-zinc-300">{runResult.watchlistScanned}</span> scanned</span>
                <span><span className="font-mono text-emerald-400">{runResult.buys}</span> buys</span>
                <span><span className="font-mono text-zinc-500">{runResult.skipped}</span> skipped</span>
                <span><span className="font-mono text-red-400">{runResult.vetoed}</span> vetoed</span>
              </div>
              <div className="mt-2 space-y-1">
                {runResult.results?.map((r: any) => (
                  <div key={r.ticker} className="flex items-center gap-3 text-xs">
                    <span className="font-mono font-bold w-12 text-zinc-300">{r.ticker}</span>
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold border',
                      r.action.includes('BUY') ? 'border-emerald-800 bg-emerald-900/30 text-emerald-400' :
                      r.action === 'VETOED' ? 'border-red-900 bg-red-900/20 text-red-400' :
                      'border-zinc-800 bg-zinc-900 text-zinc-600'
                    )}>{r.action}</span>
                    <span className="text-zinc-600 flex-1 truncate">{r.reason ?? `Score ${r.score} · MOS ${r.mos?.toFixed(1)}%`}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Notifications */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h2 className="mb-1 text-xs font-medium uppercase tracking-widest text-zinc-500">Notifications</h2>
        <p className="mb-4 text-xs text-zinc-600">Get push + email alerts on every trade, sell signal, and full-run summary.</p>

        <div className="space-y-4">
          {/* ntfy push */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-zinc-300">Push Notifications (ntfy)</span>
              <span className="rounded border border-emerald-800/50 bg-emerald-900/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-500">FREE</span>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 text-xs text-zinc-500 space-y-2">
              <p>Since you already have ntfy, just add your topic to Railway:</p>
              <code className="block text-zinc-300 bg-zinc-900 rounded px-2 py-1">NTFY_TOPIC=your-secret-topic-name</code>
              <p className="text-zinc-600">Optional — for private topics with auth:</p>
              <code className="block text-zinc-400">NTFY_TOKEN=your-ntfy-token</code>
              <code className="block text-zinc-400">NTFY_SERVER=https://ntfy.sh  <span className="text-zinc-700"># or self-hosted</span></code>
            </div>
          </div>

          {/* Email via Resend */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-zinc-300">Email (Resend)</span>
              <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500">OPTIONAL</span>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 text-xs text-zinc-500 space-y-2">
              <code className="block text-zinc-400">RESEND_API_KEY=re_xxxxxxxxxxxx</code>
              <code className="block text-zinc-400">NOTIFY_EMAIL=you@example.com</code>
              <p className="text-zinc-600">Free at <a href="https://resend.com" target="_blank" rel="noopener noreferrer" className="text-violet-500 hover:underline">resend.com</a> — 3,000 emails/month</p>
            </div>
          </div>

          <NotifyTestButton />
        </div>
      </div>

      {/* Railway cron instructions */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-zinc-500">Railway Cron Schedule</h2>
        <p className="mb-3 text-xs text-zinc-500">
          The autopilot runs automatically via Railway&apos;s cron scheduler. After deploying, add a cron job in your Railway service settings:
        </p>
        <div className="space-y-2">
          {[
            { schedule: '0 9 * * 1-5', label: 'Weekday scan (9am ET)', cmd: 'curl -X POST $RAILWAY_PUBLIC_DOMAIN/api/autopilot/run -H "Authorization: Bearer $CRON_SECRET"' },
            { schedule: '0 10 1 1,4,7,10 *', label: 'Quarterly rebalance (1st of quarter)', cmd: 'curl -X POST $RAILWAY_PUBLIC_DOMAIN/api/autopilot/rebalance -H "Authorization: Bearer $CRON_SECRET"' },
          ].map(({ schedule, label, cmd }) => (
            <div key={schedule} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <code className="text-xs font-mono text-violet-400">{schedule}</code>
                <span className="text-xs text-zinc-600">— {label}</span>
              </div>
              <code className="block text-[10px] text-zinc-600 leading-relaxed break-all">{cmd}</code>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[10px] text-zinc-700">
          Set <code className="rounded bg-zinc-800 px-1">CRON_SECRET</code> as an env variable in Railway to secure the endpoint.
        </p>
      </div>
    </div>
  )
}
