'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import type { YearlyValue } from '@/types'
import { formatCurrency, formatNumber } from '@/lib/utils'

interface FundamentalChartProps {
  data: YearlyValue[]
  label: string
  format?: 'currency' | 'number' | 'percent'
  referenceValue?: number
  referenceLabel?: string
}

const formatValue = (v: number, format: string) => {
  if (format === 'currency') return formatCurrency(v, 0)
  if (format === 'percent') return `${v.toFixed(1)}%`
  return formatNumber(v, 2)
}

export function FundamentalChart({
  data,
  label,
  format = 'number',
  referenceValue,
  referenceLabel,
}: FundamentalChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded border border-zinc-800 bg-zinc-900">
        <span className="text-xs text-zinc-600">No data available</span>
      </div>
    )
  }

  const isPositiveTrend =
    data.length >= 2 && data[data.length - 1].value >= data[0].value

  return (
    <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-widest text-zinc-500">{label}</span>
        <span
          className={`text-xs font-medium ${isPositiveTrend ? 'text-emerald-400' : 'text-red-400'}`}
        >
          {isPositiveTrend ? '↑' : '↓'} trend
        </span>
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="year"
            tick={{ fill: '#52525b', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis hide />
          <Tooltip
            contentStyle={{
              background: '#18181b',
              border: '1px solid #3f3f46',
              borderRadius: 4,
              padding: '6px 10px',
            }}
            labelStyle={{ color: '#a1a1aa', fontSize: 11 }}
            itemStyle={{ color: '#e4e4e7', fontSize: 12 }}
            formatter={(value) => [formatValue(Number(value), format), label]}
          />
          {referenceValue && (
            <ReferenceLine
              y={referenceValue}
              stroke="#52525b"
              strokeDasharray="3 3"
              label={{ value: referenceLabel, fill: '#52525b', fontSize: 10 }}
            />
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke={isPositiveTrend ? '#34d399' : '#f87171'}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, fill: '#e4e4e7' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
