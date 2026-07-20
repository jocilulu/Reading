// 文章速记侧栏:快捷键 N 呼出,支持基础 Markdown,编辑/预览切换
import React, { useEffect, useState } from 'react'
import { marked } from 'marked'

export default function NotesSidebar({ open, text, onChange, onClose }) {
  const [mode, setMode] = useState('edit') // edit | preview

  useEffect(() => {
    if (open) setMode('edit')
  }, [open])

  if (!open) return null

  return (
    <aside className="w-80 shrink-0 border-l border-ink-100 dark:border-ink-800 bg-ink-50/60 dark:bg-ink-800/40 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-ink-100 dark:border-ink-800">
        <span className="text-sm font-medium">📝 文章速记</span>
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => setMode(mode === 'edit' ? 'preview' : 'edit')}
            className="px-2 py-0.5 rounded border border-ink-200 dark:border-ink-700 hover:bg-ink-100 dark:hover:bg-ink-700"
          >
            {mode === 'edit' ? '预览' : '编辑'}
          </button>
          <button
            onClick={onClose}
            className="text-ink-700/50 hover:text-ink-700 dark:text-ink-100/60"
            title="关闭(快捷键 N)"
          >
            ✕
          </button>
        </div>
      </div>
      {mode === 'edit' ? (
        <textarea
          className="flex-1 resize-none bg-transparent p-4 text-sm leading-relaxed focus:outline-none"
          placeholder={'记录关于这篇文章的想法…\n\n支持基础 Markdown:# 标题、- 列表、**加粗**、> 引用'}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div
          className="flex-1 overflow-y-auto p-4 text-sm md-preview"
          dangerouslySetInnerHTML={{
            __html: marked.parse(text || '*暂无笔记*', { breaks: true }),
          }}
        />
      )}
      <div className="px-4 py-2 text-[10px] text-ink-700/40 dark:text-ink-100/40 border-t border-ink-100 dark:border-ink-800">
        自动保存 · 快捷键 N 开关 · 播放音频时也可记录
      </div>
    </aside>
  )
}
