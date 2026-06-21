'use client'
import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

interface MobileMenuCtx { isOpen: boolean; open: () => void; close: () => void; toggle: () => void }
const MobileMenuContext = createContext<MobileMenuCtx>({ isOpen: false, open: () => {}, close: () => {}, toggle: () => {} })

export function MobileMenuProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const open   = useCallback(() => setIsOpen(true),          [])
  const close  = useCallback(() => setIsOpen(false),         [])
  const toggle = useCallback(() => setIsOpen(v => !v),       [])
  return (
    <MobileMenuContext.Provider value={{ isOpen, open, close, toggle }}>
      {children}
    </MobileMenuContext.Provider>
  )
}

export const useMobileMenu = () => useContext(MobileMenuContext)
