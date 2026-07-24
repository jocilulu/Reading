// 每周概览页:文章卡片、标签筛选、拖拽排序、⭐ 优先
import React, { useMemo, useState } from 'react'
import { useStore, useCurrentWeekKey, articlesOfWeek, magazineName } from '../../store/AppStore'
import UploadModal from '../upload/UploadModal'
import { weekLabel, languageLabel, classNames } from '../../lib/utils'

const STATUS_META = {
  unread: { label: '未读', cls: 'bg-ink-100 text-ink-700/70 dark:bg-ink-700 dark:text-ink-100/70' },
  reading: { label: '阅读中', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300' },
  read: { label: '已读完', cls: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300' },
}

export default function OverviewPage() {
  const { state, dispatch } = useStore()
  const weekKey = useCurrentWeekKey()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [tagFilter, setTagFilter] = useState(null)
  const [dragId, setDragId] = useState(null)

  const articles = articlesOfWeek(state, weekKey)
  const allTags = useMemo(
    () => [...new Set(articles.flatMap((a) => a.tags || []))],
    [articles]
  )
  const shown = tagFilter
    ? articles.filter((a) => (a.tags || []).includes(tagFilter))
    : articles

  const magazines = state.magazines.filter((m) => m.weekKey === weekKey)

  const handleDrop = (targetId) => {
    if (!dragId || dragId === targetId) return
    const ids = articles.map((a) => a.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    dispatch({ type: 'reorderArticles', orderedIds: ids })
    setDragId(null)
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">{weekLabel(weekKey)}</h1>
        <button
          onClick={() => setUploadOpen(true)}
          className="px-4 py-1.5 rounded-md text-sm bg-ink-800 text-white dark:bg-ink-100 dark:text-ink-900 hover:opacity-90"
        >
          + 上传周刊
        </button>
      </div>
      <div className="text-sm text-ink-700/50 dark:text-ink-100/50 mb-6 flex flex-wrap items-center gap-1.5">
        {magazines.length ? (
          <>
            <span>本期已收录:</span>
            {magazines.map((m) => (
              <MagazineChip
                key={m.id}
                magazine={m}
                articleCount={state.articles.filter((a) => a.magazineId === m.id).length}
                onRename={(name) =>
                  dispatch({ type: 'updateMagazine', id: m.id, patch: { name } })
                }
                onDelete={() => dispatch({ type: 'deleteMagazine', id: m.id })}
              />
            ))}
          </>
        ) : (
          '本周还没有上传周刊'
        )}
      </div>

      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-5">
          <FilterChip active={!tagFilter} onClick={() => setTagFilter(null)}>
            全部
          </FilterChip>
          {allTags.map((t) => (
            <FilterChip key={t} active={tagFilter === t} onClick={() => setTagFilter(t)}>
              {t}
            </FilterChip>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="text-center py-24 text-ink-700/40 dark:text-ink-100/40 text-sm">
          {articles.length === 0
            ? '点击右上角「上传周刊」,把这周想看的内容交给我吧'
            : '该标签下没有文章'}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {shown.map((a) => (
            <ArticleCard
              key={a.id}
              article={a}
              magazine={magazineName(state, a.magazineId)}
              draggable={!tagFilter}
              onDragStart={() => setDragId(a.id)}
              onDrop={() => handleDrop(a.id)}
              onOpen={() =>
                dispatch({ type: 'navigate', route: { page: 'reader', articleId: a.id } })
              }
              onToggleStar={() =>
                dispatch({ type: 'updateArticle', id: a.id, patch: { starred: !a.starred } })
              }
            />
          ))}
        </div>
      )}

      {uploadOpen && (
        <UploadModal defaultWeekKey={weekKey} onClose={() => setUploadOpen(false)} />
      )}
    </div>
  )
}

// 周刊名称:点击铅笔即可改名(如「经济学人 7月19日刊」),🗑 删除整份周刊
function MagazineChip({ magazine, articleCount, onRename, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(magazine.name)
  if (editing) {
    return (
      <input
        autoFocus
        className="px-2 py-0.5 rounded-full border border-ink-300 dark:border-ink-600 bg-transparent text-xs w-44"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          onRename(value.trim() || magazine.name)
          setEditing(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.target.blur()
          if (e.key === 'Escape') {
            setValue(magazine.name)
            setEditing(false)
          }
        }}
      />
    )
  }
  return (
    <span className="group px-2 py-0.5 rounded-full bg-ink-100 dark:bg-ink-700 text-xs flex items-center gap-1">
      {magazine.name}
      <button
        title="重命名"
        onClick={() => {
          setValue(magazine.name)
          setEditing(true)
        }}
        className="opacity-0 group-hover:opacity-60 hover:!opacity-100"
      >
        ✏️
      </button>
      <button
        title="删除这份周刊"
        onClick={() => {
          if (
            window.confirm(
              `确定删除「${magazine.name}」吗?\n将同时删除其中 ${articleCount} 篇文章及相关笔记、生词。此操作不可恢复。`
            )
          ) {
            onDelete()
          }
        }}
        className="opacity-0 group-hover:opacity-60 hover:!opacity-100"
      >
        🗑️
      </button>
    </span>
  )
}

function FilterChip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={classNames(
        'px-2.5 py-0.5 rounded-full text-xs border transition-colors',
        active
          ? 'bg-ink-800 text-white border-ink-800 dark:bg-ink-100 dark:text-ink-900 dark:border-ink-100'
          : 'border-ink-200 dark:border-ink-700 text-ink-700/60 dark:text-ink-100/60 hover:border-ink-400'
      )}
    >
      {children}
    </button>
  )
}

export function ArticleCard({
  article,
  magazine,
  draggable,
  onDragStart,
  onDrop,
  onOpen,
  onToggleStar,
}) {
  const status = STATUS_META[article.status] || STATUS_META.unread
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onClick={onOpen}
      className="group border border-ink-200 dark:border-ink-700 rounded-xl p-4 cursor-pointer bg-white dark:bg-ink-800/60 hover:shadow-md hover:-translate-y-px transition-all"
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <h3 className="font-medium leading-snug">{article.title}</h3>
        <button
          title={article.starred ? '取消优先' : '标记优先'}
          onClick={(e) => {
            e.stopPropagation()
            onToggleStar()
          }}
          className={classNames(
            'shrink-0 text-lg leading-none',
            article.starred ? '' : 'opacity-20 group-hover:opacity-60'
          )}
        >
          ⭐
        </button>
      </div>
      {article.summary ? (
        <p className="text-sm text-ink-700/60 dark:text-ink-100/60 mb-2.5 line-clamp-2">
          {article.summary}
        </p>
      ) : (
        <p className="text-sm text-ink-700/30 dark:text-ink-100/30 mb-2.5 italic">
          摘要生成中…
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className={classNames('px-1.5 py-0.5 rounded', status.cls)}>{status.label}</span>
        {article.listenedDone && (
          <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
            已听完
          </span>
        )}
        <span className="px-1.5 py-0.5 rounded bg-ink-100 dark:bg-ink-700 text-ink-700/60 dark:text-ink-100/60">
          {languageLabel(article.language)}
        </span>
        {(article.tags || []).map((t) => (
          <span
            key={t}
            className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
          >
            #{t}
          </span>
        ))}
        <span className="ml-auto text-ink-700/40 dark:text-ink-100/40">
          {magazine} · 读 {article.readMinutes} 分 / 听 {article.listenMinutes} 分
        </span>
      </div>
    </div>
  )
}
