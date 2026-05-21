'use client'
import { createContext, useContext, useState, ReactNode } from 'react'

interface MobileMenuCtx { isOpen: boolean; open: () => void; close: () => void; toggle: () => void }
const MobileMenuContext = createContext<MobileMenuCtx>({ isOpen: false, open: () => {}, close: () => {}, toggle: () => {} })

export function MobileMenuProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <MobileMenuContext.Provider value={{ isOpen, open: () => setIsOpen(true), close: () => setIsOpen(false), toggle: () => setIsOpen(v => !v) }}>
      {children}
    </MobileMenuContext.Provider>
  )
}

export const useMobileMenu = () => useContext(MobileMenuContext)
