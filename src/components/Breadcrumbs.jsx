import React from 'react'
import { useStore, useCurrentWeekKey } from '../store/AppStore'
import { weekLabel } from '../lib/utils'

const PAGE_NAMES = {
  overview: '本周周刊',
  archive: '往期归档',
  notes: '我的笔记',
  vocab: '生词本',
  stats: '收听统计',
}

export default function Breadcrumbs({ sidebarOpen, onToggleSidebar }) {
  const { state, dispatch } = useStore()
  const weekKey = useCurrentWeekKey()
  const { page, articleId } = state.route
  const article = articleId ? state.articles.find((a) => a.id === articleId) : null

  const crumbs = []
  if (page === 'reader' && article) {
    crumbs.push({
      label: weekLabel(article.weekKey),
      onClick: () =>
        dispatch({
          type: 'navigate',
          route: { page: 'overview', weekKey: article.weekKey, articleId: null },
        }),
    })
    crumbs.push({ label: article.title })
  } else if (page === 'overview') {
    crumbs.push({ label: weekLabel(weekKey) })
  } else {
    crumbs.push({ label: PAGE_NAMES[page] || page })
  }

  return (
    <header className="h-12 shrink-0 border-b border-ink-100 dark:border-ink-800 flex items-center px-4 gap-2 text-sm">
      {!sidebarOpen && (
        <button
          onClick={onToggleSidebar}
          className="text-ink-700/50 hover:text-ink-700 dark:text-ink-100/50 dark:hover:text-ink-100 mr-1"
          title="展开侧边栏"
        >
          »
        </button>
      )}
      {crumbs.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-ink-700/30 dark:text-ink-100/30">/</span>}
          {c.onClick ? (
            <button
              onClick={c.onClick}
              className="hover:underline text-ink-700/70 dark:text-ink-100/70"
            >
              {c.label}
            </button>
          ) : (
            <span className="font-medium truncate max-w-md">{c.label}</span>
          )}
        </React.Fragment>
      ))}
    </header>
  )
}
