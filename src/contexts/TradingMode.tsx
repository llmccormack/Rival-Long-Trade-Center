'use client'

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export type TradingMode = 'paper' | 'live'

interface TradingModeContextValue {
  mode: TradingMode
  setMode: (mode: TradingMode) => void
  isPaper: boolean
  isLive: boolean
}

const TradingModeContext = createContext<TradingModeContextValue>({
  mode: 'paper',
  setMode: () => {},
  isPaper: true,
  isLive: false,
})

export function TradingModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<TradingMode>('paper')

  useEffect(() => {
    const saved = localStorage.getItem('rival_trading_mode') as TradingMode | null
    if (saved === 'live' || saved === 'paper') setModeState(saved)
  }, [])

  const setMode = (next: TradingMode) => {
    setModeState(next)
    localStorage.setItem('rival_trading_mode', next)
  }

  return (
    <TradingModeContext.Provider value={{ mode, setMode, isPaper: mode === 'paper', isLive: mode === 'live' }}>
      {children}
    </TradingModeContext.Provider>
  )
}

export function useTradingMode() {
  return useContext(TradingModeContext)
}
