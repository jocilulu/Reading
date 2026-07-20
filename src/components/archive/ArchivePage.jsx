// 往期归档:按周分组展示历史周刊
import React from 'react'
import { useStore } from '../../store/AppStore'
import { weekLabel } from '../../lib/utils'

export default function ArchivePage() {
  const { state, dispatch } = useStore()
  const weeks = [...new Set(state.magazines.map((m) => m.weekKey))].sort().reverse()

  if (!weeks.length) {
    return (
      <div className="text-center py-24 text-ink-700/40 dark:text-ink-100/40 text-sm">
        还没有任何归档,先在「本周周刊」上传一份吧
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <h1 className="text-2xl font-semibold">往期归档</h1>
      {weeks.map((wk) => {
        const magazines = state.magazines.filter((m) => m.weekKey === wk)
        const articles = state.articles.filter((a) => a.weekKey === wk)
        const readCount = articles.filter((a) => a.status === 'read').length
        return (
          <div
            key={wk}
            className="border border-ink-200 dark:border-ink-700 rounded-xl p-4 hover:shadow-sm cursor-pointer transition-shadow"
            onClick={() =>
              dispatch({ type: 'navigate', route: { page: 'overview', weekKey: wk } })
            }
          >
            <div className="flex items-center justify-between">
              <h2 className="font-medium">{weekLabel(wk)}</h2>
              <span className="text-xs text-ink-700/50 dark:text-ink-100/50">
                {articles.length} 篇 · 已读 {readCount}
              </span>
            </div>
            <p className="text-sm text-ink-700/60 dark:text-ink-100/60 mt-1">
              {magazines.map((m) => m.name).join('、')}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {articles.slice(0, 6).map((a) => (
                <span
                  key={a.id}
                  onClick={(e) => {
                    e.stopPropagation()
                    dispatch({ type: 'navigate', route: { page: 'reader', articleId: a.id } })
                  }}
                  className="text-xs px-2 py-0.5 rounded-full bg-ink-100 dark:bg-ink-700 hover:bg-ink-200 dark:hover:bg-ink-600"
                >
                  {a.title.length > 18 ? a.title.slice(0, 18) + '…' : a.title}
                </span>
              ))}
              {articles.length > 6 && (
                <span className="text-xs text-ink-700/40 dark:text-ink-100/40">
                  +{articles.length - 6}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
