// 顶部固定音频播放器:播放/暂停、进度条、倍速、±15 秒,驱动句子高亮
import React, { useEffect, useRef, useState } from 'react'
import { formatSeconds } from '../../lib/utils'
import { ttsProviderName } from '../../lib/tts'

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2]

export default function AudioPlayer({ player, playerState, sentenceIndex, sentenceCount }) {
  const state = playerState
  const [, setTick] = useState(0) // 驱动进度刷新
  const barRef = useRef(null)

  useEffect(() => {
    if (!player) return
    const t = setInterval(() => setTick((v) => v + 1), 1000)
    return () => clearInterval(t)
  }, [player])

  if (!player) return null

  const total = player.totalSeconds()
  const elapsed = Math.min(player.elapsedSeconds(), total)
  const ratio = total ? elapsed / total : 0
  const playing = state === 'playing'

  const seek = (e) => {
    const rect = barRef.current.getBoundingClientRect()
    const r = (e.clientX - rect.left) / rect.width
    player.seekRatio(r)
  }

  return (
    <div className="sticky top-0 z-20 bg-white/95 dark:bg-ink-900/95 backdrop-blur border-b border-ink-100 dark:border-ink-800">
      <div className="max-w-article mx-auto px-4 py-2.5 flex items-center gap-3">
        <button
          onClick={() => player.skip(-15)}
          className="text-sm text-ink-700/60 dark:text-ink-100/60 hover:text-ink-700 dark:hover:text-ink-100"
          title="后退 15 秒"
        >
          ⏪15
        </button>
        <button
          onClick={() => player.toggle()}
          className="w-9 h-9 rounded-full bg-ink-800 dark:bg-ink-100 text-white dark:text-ink-900 flex items-center justify-center hover:opacity-90"
          title={playing ? '暂停' : '播放'}
        >
          {state === 'loading' ? (
            <span className="animate-pulse text-xs">…</span>
          ) : playing ? (
            '⏸'
          ) : (
            '▶'
          )}
        </button>
        <button
          onClick={() => player.skip(15)}
          className="text-sm text-ink-700/60 dark:text-ink-100/60 hover:text-ink-700 dark:hover:text-ink-100"
          title="前进 15 秒"
        >
          15⏩
        </button>

        <div className="flex-1 flex items-center gap-2 text-xs text-ink-700/50 dark:text-ink-100/50">
          <span className="tabular-nums">{formatSeconds(elapsed)}</span>
          <div
            ref={barRef}
            onClick={seek}
            className="flex-1 h-5 flex items-center cursor-pointer group"
          >
            <div className="w-full h-1 rounded-full bg-ink-100 dark:bg-ink-700 relative">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-ink-800 dark:bg-ink-100"
                style={{ width: `${ratio * 100}%` }}
              />
              <div
                className="absolute w-3 h-3 rounded-full bg-ink-800 dark:bg-ink-100 -top-1 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ left: `calc(${ratio * 100}% - 6px)` }}
              />
            </div>
          </div>
          <span className="tabular-nums">≈{formatSeconds(total)}</span>
        </div>

        <select
          className="text-xs bg-transparent border border-ink-200 dark:border-ink-700 rounded px-1 py-0.5 dark:bg-ink-900"
          value={player.rate}
          onChange={(e) => player.setRate(Number(e.target.value))}
          title="倍速"
        >
          {RATES.map((r) => (
            <option key={r} value={r}>
              {r}x
            </option>
          ))}
        </select>
        <span
          className="text-[10px] text-ink-700/40 dark:text-ink-100/40 hidden sm:block"
          title={`第 ${sentenceIndex + 1}/${sentenceCount} 句`}
        >
          {ttsProviderName()}
        </span>
      </div>
    </div>
  )
}
