import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { SideNav } from '@/components/ui/SideNav'
import { TopBar } from '@/components/ui/TopBar'
import { TradingModeProvider } from '@/contexts/TradingMode'
import { MobileMenuProvider } from '@/contexts/MobileMenu'
import { MobileNav } from '@/components/ui/MobileNav'
import { KeepAlive } from '@/components/ui/KeepAlive'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Rival Automations — Value Investing Platform',
  description: 'Systematic value investing powered by Graham, Buffett, and Fisher philosophy',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} dark h-full`}>
      <body className="flex h-full min-h-screen bg-zinc-950 text-zinc-100 antialiased overflow-x-hidden">
        <TradingModeProvider>
          <MobileMenuProvider>
            <SideNav />
            <div className="flex flex-1 flex-col overflow-hidden">
              <TopBar />
              <main className="flex flex-1 flex-col overflow-auto pb-16 md:pb-0">{children}</main>
            </div>
            <MobileNav />
            <KeepAlive />
          </MobileMenuProvider>
        </TradingModeProvider>
      </body>
    </html>
  )
}
