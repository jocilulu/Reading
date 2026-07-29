import React from 'react'
import { useStore } from '../store/AppStore'
import { classNames } from '../lib/utils'

const NAV = [
  { key: 'overview', icon: '📥', label: '本周周刊' },
  { key: 'archive', icon: '📚', label: '往期归档' },
  { key: 'notes', icon: '📝', label: '我的笔记' },
  { key: 'vocab', icon: '📖', label: '生词本' },
  { key: 'stats', icon: '📊', label: '收听统计' },
]

export default function Sidebar({ open, onToggle, onOpenSettings, onNavigate }) {
  const { state, dispatch } = useStore()
  const page = state.route.page

  if (!open) return null

  return (
    <>
      {/* 手机上侧边栏为抽屉,点遮罩关闭 */}
      <div className="md:hidden fixed inset-0 bg-black/30 z-30" onClick={onToggle} />
      <aside className="w-56 shrink-0 border-r border-ink-100 dark:border-ink-800 bg-ink-50 dark:bg-ink-800/40 flex flex-col max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:bg-white max-md:dark:bg-ink-900">
      <div className="flex items-center justify-between px-4 py-4">
        <div className="font-semibold text-ink-800 dark:text-ink-50">
          周刊阅读伴侣
        </div>
        <button
          onClick={onToggle}
          className="text-ink-700/50 hover:text-ink-700 dark:text-ink-100/50 dark:hover:text-ink-100 text-sm"
          title="收起侧边栏"
        >
          «
        </button>
      </div>
      <nav className="px-2 space-y-0.5">
        {NAV.map((item) => (
          <button
            key={item.key}
            onClick={() => {
              dispatch({ type: 'navigate', route: { page: item.key, articleId: null } })
              onNavigate?.()
            }}
            className={classNames(
              'w-full text-left px-3 py-1.5 rounded-md text-sm flex items-center gap-2 transition-colors',
              page === item.key
                ? 'bg-ink-200/70 dark:bg-ink-700 font-medium'
                : 'hover:bg-ink-100 dark:hover:bg-ink-800'
            )}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="mt-auto p-3 space-y-1">
        <button
          onClick={() =>
            dispatch({
              type: 'updateSettings',
              patch: { dark: !state.settings.dark },
            })
          }
          className="w-full text-left px-3 py-1.5 rounded-md text-sm hover:bg-ink-100 dark:hover:bg-ink-800"
        >
          {state.settings.dark ? '☀️ 浅色模式' : '🌙 深色模式'}
        </button>
        <button
          onClick={onOpenSettings}
          className="w-full text-left px-3 py-1.5 rounded-md text-sm hover:bg-ink-100 dark:hover:bg-ink-800"
        >
          ⚙️ 设置
        </button>
      </div>
      </aside>
    </>
  )
}
