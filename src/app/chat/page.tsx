'use client'

import { useState, useRef, useEffect } from 'react'
import { SideNav } from '@/components/ui/SideNav'
import { TopBar } from '@/components/ui/TopBar'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTED_QUESTIONS = [
  "Why hasn't the bot made any buys yet?",
  "Which stock is closest to qualifying for a buy?",
  "What's the current market temperature?",
  "How is my paper portfolio performing?",
  "Explain the margin of safety requirement",
  "What would make a stock pass all the criteria?",
]

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async (text: string) => {
    if (!text.trim() || loading) return
    const userMsg: Message = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
      })
      const data = await res.json()
      if (data.content) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.content }])
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-[100dvh] bg-zinc-950 text-zinc-100 overflow-hidden">
      <SideNav />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar />
        <div className="flex-1 flex flex-col pb-16 md:pb-0 overflow-hidden">
          <div className="flex-1 flex flex-col max-w-3xl mx-auto w-full px-4 gap-4 overflow-hidden">
            {messages.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center gap-6 py-8 overflow-y-auto">
                <div className="text-center">
                  <div className="text-4xl mb-3">🤖</div>
                  <h2 className="text-lg font-semibold text-zinc-200 mb-1">AI Investment Analyst</h2>
                  <p className="text-sm text-zinc-500">Ask anything about your portfolio, watchlist, or value investing strategy.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                  {SUGGESTED_QUESTIONS.map(q => (
                    <button
                      key={q}
                      onClick={() => send(q)}
                      className="text-left text-xs px-3 py-2.5 rounded-lg border border-zinc-800 bg-zinc-900 hover:border-violet-700 hover:bg-violet-900/10 text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.length > 0 && (
              <div className="flex-1 flex flex-col gap-4 py-4 overflow-y-auto">
                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-violet-600 text-white'
                        : 'bg-zinc-900 border border-zinc-800 text-zinc-200'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex justify-start">
                    <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
                      <div className="flex gap-1">
                        <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            )}

            <div className="flex gap-2 py-3 border-t border-zinc-800 shrink-0">
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send(input)}
                placeholder="Ask about your portfolio, stocks, or strategy..."
                className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-600"
                disabled={loading}
              />
              <button
                onClick={() => send(input)}
                disabled={loading || !input.trim()}
                className="px-4 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
