// 收听统计:本周总时长(大数字+周对比)、每日柱状图、完成篇数、历史周趋势
// 图表为手写 SVG:单序列蓝色、细 mark、hairline 网格、文本用墨色 token、悬停提示
import React, { useMemo, useState } from 'react'
import { useStore } from '../../store/AppStore'
import {
  weekKeyOf,
  shiftWeekKey,
  daysOfWeek,
  weekKeyOfDayKey,
  weekLabel,
  formatHoursMinutes,
  formatSeconds,
} from '../../lib/utils'

// 单序列图表色(明/暗两档均通过对比校验的参考蓝)
const SERIES = { light: '#2a78d6', dark: '#3987e5' }
const DAY_NAMES = ['一', '二', '三', '四', '五', '六', '日']

export default function StatsPage() {
  const { state } = useStore()
  const dark = state.settings.dark
  const series = dark ? SERIES.dark : SERIES.light

  const thisWeek = weekKeyOf()
  const lastWeek = shiftWeekKey(thisWeek, -1)

  const { dailySeconds, weekTotals } = useMemo(() => {
    const dailySeconds = daysOfWeek(thisWeek).map((day) => ({
      day,
      seconds: state.listening[day] || 0,
    }))
    const weekTotals = new Map()
    for (const [day, sec] of Object.entries(state.listening)) {
      const wk = weekKeyOfDayKey(day)
      weekTotals.set(wk, (weekTotals.get(wk) || 0) + sec)
    }
    return { dailySeconds, weekTotals }
  }, [state.listening, thisWeek])

  const thisTotal = weekTotals.get(thisWeek) || 0
  const lastTotal = weekTotals.get(lastWeek) || 0
  const delta = thisTotal - lastTotal

  const weekArticles = state.articles.filter((a) => a.weekKey === thisWeek)
  const readCount = weekArticles.filter((a) => a.status === 'read').length
  const listenedCount = weekArticles.filter((a) => a.listenedDone).length

  // 历史周趋势:从最早有记录的周到本周,最多取近 12 周
  const trend = useMemo(() => {
    const keys = [...weekTotals.keys()].sort()
    if (!keys.length) return []
    let cursor = keys[0]
    const all = []
    let guard = 0
    while (cursor <= thisWeek && guard++ < 200) {
      all.push({ week: cursor, seconds: weekTotals.get(cursor) || 0 })
      cursor = shiftWeekKey(cursor, 1)
    }
    return all.slice(-12)
  }, [weekTotals, thisWeek])

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
      <h1 className="text-2xl font-semibold">收听统计</h1>

      {/* 统计卡片行 */}
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="border border-ink-200 dark:border-ink-700 rounded-xl p-4 sm:col-span-1">
          <div className="text-sm text-ink-700/60 dark:text-ink-100/60 mb-1">
            本周收听总时长
          </div>
          <div className="text-4xl font-semibold">
            {formatHoursMinutes(thisTotal)}
          </div>
          <div className="text-sm mt-1">
            {delta >= 0 ? (
              <span className="text-[#006300] dark:text-[#0ca30c]">
                ▲ 比上周多 {formatHoursMinutes(Math.abs(delta))}
              </span>
            ) : (
              <span className="text-ink-700/60 dark:text-ink-100/60">
                ▼ 比上周少 {formatHoursMinutes(Math.abs(delta))}
              </span>
            )}
          </div>
        </div>
        <StatTile label="本周读完" value={readCount} unit="篇" />
        <StatTile label="本周听完" value={listenedCount} unit="篇" />
      </div>

      {/* 每日柱状图 */}
      <section className="border border-ink-200 dark:border-ink-700 rounded-xl p-4">
        <h2 className="text-sm font-medium mb-3">本周每日收听时长</h2>
        <DailyBars data={dailySeconds} color={series} />
      </section>

      {/* 历史周趋势 */}
      <section className="border border-ink-200 dark:border-ink-700 rounded-xl p-4">
        <h2 className="text-sm font-medium mb-3">历史周趋势</h2>
        {trend.length < 2 ? (
          <p className="text-sm text-ink-700/40 dark:text-ink-100/40 py-8 text-center">
            连续收听两周后,这里会出现趋势折线
          </p>
        ) : (
          <TrendLine data={trend} color={series} />
        )}
      </section>

      <p className="text-xs text-ink-700/40 dark:text-ink-100/40">
        统计只计入音频实际播放时间(暂停不计),按周(周一为起点)汇总。
      </p>
    </div>
  )
}

function StatTile({ label, value, unit }) {
  return (
    <div className="border border-ink-200 dark:border-ink-700 rounded-xl p-4">
      <div className="text-sm text-ink-700/60 dark:text-ink-100/60 mb-1">{label}</div>
      <div className="text-4xl font-semibold">
        {value}
        <span className="text-base font-normal text-ink-700/50 dark:text-ink-100/50 ml-1">
          {unit}
        </span>
      </div>
    </div>
  )
}

// ---- 每日柱状图:单序列、柱宽 ≤24px、顶端 4px 圆角、底部平、hairline 网格 ----

function DailyBars({ data, color }) {
  const [hover, setHover] = useState(null)
  const W = 560
  const H = 180
  const pad = { top: 12, right: 8, bottom: 24, left: 40 }
  const innerW = W - pad.left - pad.right
  const innerH = H - pad.top - pad.bottom
  const max = Math.max(60, ...data.map((d) => d.seconds))
  // 纵轴取整刻度(分钟)
  const maxMin = Math.ceil(max / 60 / 5) * 5 || 5
  const band = innerW / data.length
  const barW = Math.min(24, band * 0.5)

  const yOf = (sec) => pad.top + innerH * (1 - sec / (maxMin * 60))

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="本周每日收听时长柱状图">
        {/* 网格 + 刻度 */}
        {[0, 0.5, 1].map((f) => {
          const y = pad.top + innerH * (1 - f)
          return (
            <g key={f}>
              <line
                x1={pad.left}
                x2={W - pad.right}
                y1={y}
                y2={y}
                className="stroke-ink-200 dark:stroke-ink-700"
                strokeWidth="1"
              />
              <text
                x={pad.left - 6}
                y={y + 3.5}
                textAnchor="end"
                fontSize="10"
                className="fill-ink-700/40 dark:fill-ink-100/40"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {Math.round(maxMin * f)}分
              </text>
            </g>
          )
        })}
        {data.map((d, i) => {
          const x = pad.left + band * i + (band - barW) / 2
          const y = yOf(d.seconds)
          const h = pad.top + innerH - y
          const r = Math.min(4, h) // 顶端圆角、底部保持平
          return (
            <g key={d.day}>
              {/* 命中区域大于柱体 */}
              <rect
                x={pad.left + band * i}
                y={pad.top}
                width={band}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
              {h > 0 && (
                <path
                  d={`M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + barW - r},${y} Q${x + barW},${y} ${x + barW},${y + r} L${x + barW},${y + h} Z`}
                  fill={color}
                  opacity={hover === null || hover === i ? 1 : 0.45}
                  pointerEvents="none"
                />
              )}
              <text
                x={pad.left + band * i + band / 2}
                y={H - 8}
                textAnchor="middle"
                fontSize="11"
                className="fill-ink-700/50 dark:fill-ink-100/50"
              >
                {DAY_NAMES[i]}
              </text>
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <div
          className="absolute -translate-x-1/2 -top-1 px-2 py-1 rounded-md bg-ink-800 text-white dark:bg-ink-100 dark:text-ink-900 text-xs pointer-events-none whitespace-nowrap"
          style={{ left: `${((pad.left + band * hover + band / 2) / W) * 100}%` }}
        >
          周{DAY_NAMES[hover]} · {formatSeconds(data[hover].seconds)}
        </div>
      )}
    </div>
  )
}

// ---- 历史周趋势:2px 折线、≥8px 端点(带表面色描边环)、端点直接标注 ----

function TrendLine({ data, color }) {
  const [hover, setHover] = useState(null)
  const W = 560
  const H = 180
  const pad = { top: 16, right: 44, bottom: 24, left: 40 }
  const innerW = W - pad.left - pad.right
  const innerH = H - pad.top - pad.bottom
  const max = Math.max(60, ...data.map((d) => d.seconds))
  const maxMin = Math.ceil(max / 60 / 10) * 10 || 10

  const xOf = (i) => pad.left + (data.length === 1 ? 0 : (innerW * i) / (data.length - 1))
  const yOf = (sec) => pad.top + innerH * (1 - sec / (maxMin * 60))
  const points = data.map((d, i) => [xOf(i), yOf(d.seconds)])
  const path = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ')
  const last = data[data.length - 1]

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label="历史每周收听时长折线图"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const px = ((e.clientX - rect.left) / rect.width) * W
          let best = 0
          let bestDist = Infinity
          points.forEach(([x], i) => {
            const dist = Math.abs(x - px)
            if (dist < bestDist) {
              bestDist = dist
              best = i
            }
          })
          setHover(best)
        }}
      >
        {[0, 0.5, 1].map((f) => {
          const y = pad.top + innerH * (1 - f)
          return (
            <g key={f}>
              <line
                x1={pad.left}
                x2={W - pad.right}
                y1={y}
                y2={y}
                className="stroke-ink-200 dark:stroke-ink-700"
                strokeWidth="1"
              />
              <text
                x={pad.left - 6}
                y={y + 3.5}
                textAnchor="end"
                fontSize="10"
                className="fill-ink-700/40 dark:fill-ink-100/40"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {Math.round(maxMin * f)}分
              </text>
            </g>
          )
        })}
        {/* 面积淡涂层(~10% 不透明度) */}
        <path
          d={`${path} L${points[points.length - 1][0]},${pad.top + innerH} L${points[0][0]},${pad.top + innerH} Z`}
          fill={color}
          opacity="0.1"
        />
        <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {/* 悬停竖线 */}
        {hover !== null && (
          <line
            x1={points[hover][0]}
            x2={points[hover][0]}
            y1={pad.top}
            y2={pad.top + innerH}
            className="stroke-ink-200 dark:stroke-ink-700"
            strokeWidth="1"
          />
        )}
        {points.map(([x, y], i) => {
          const isEnd = i === data.length - 1
          const show = isEnd || hover === i
          return (
            show && (
              <circle
                key={i}
                cx={x}
                cy={y}
                r="4"
                fill={color}
                strokeWidth="2"
                className="stroke-white dark:stroke-ink-900"
              />
            )
          )
        })}
        {/* 端点直接标注(最新一周) */}
        <text
          x={points[points.length - 1][0] + 8}
          y={points[points.length - 1][1] + 3.5}
          fontSize="10"
          className="fill-ink-700/70 dark:fill-ink-100/70"
        >
          {Math.round(last.seconds / 60)}分
        </text>
        {/* 横轴:首尾周标签 */}
        <text x={pad.left} y={H - 8} fontSize="10" className="fill-ink-700/50 dark:fill-ink-100/50">
          {data[0].week.replace('-W', ' 第')}周
        </text>
        <text
          x={W - pad.right}
          y={H - 8}
          textAnchor="end"
          fontSize="10"
          className="fill-ink-700/50 dark:fill-ink-100/50"
        >
          本周
        </text>
      </svg>
      {hover !== null && (
        <div
          className="absolute -translate-x-1/2 -top-1 px-2 py-1 rounded-md bg-ink-800 text-white dark:bg-ink-100 dark:text-ink-900 text-xs pointer-events-none whitespace-nowrap"
          style={{ left: `${(points[hover][0] / W) * 100}%` }}
        >
          {weekLabel(data[hover].week)} · {formatHoursMinutes(data[hover].seconds)}
        </div>
      )}
    </div>
  )
}
