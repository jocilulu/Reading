// 每周概览页:文章卡片、标签筛选、拖拽排序、⭐ 优先
import React, { useMemo, useState } from 'react'
import { useStore, useCurrentWeekKey, articlesOfWeek } from '../../store/AppStore'
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
    // 拖拽排序限定在同一本周刊内
    const dragged = articles.find((a) => a.id === dragId)
    const target = articles.find((a) => a.id === targetId)
    if (!dragged || !target || dragged.magazineId !== target.magazineId) return
    const ids = articles.map((a) => a.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    dispatch({ type: 'reorderArticles', orderedIds: ids })
    setDragId(null)
  }

  // 按周刊分组
  const groups = magazines
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((m) => ({
      magazine: m,
      articles: shown.filter((a) => a.magazineId === m.id),
      total: articles.filter((a) => a.magazineId === m.id).length,
    }))
    .filter((g) => g.articles.length > 0 || !tagFilter)

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
      <p className="text-sm text-ink-700/50 dark:text-ink-100/50 mb-6">
        {magazines.length
          ? `本期收录 ${magazines.length} 本周刊,共 ${articles.length} 篇文章`
          : '本周还没有上传周刊'}
      </p>

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

      {articles.length === 0 ? (
        <div className="text-center py-24 text-ink-700/40 dark:text-ink-100/40 text-sm">
          点击右上角「上传周刊」,把这周想看的内容交给我吧
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <MagazineSection
              key={g.magazine.id}
              magazine={g.magazine}
              total={g.total}
              filtered={Boolean(tagFilter)}
              onRename={(name) =>
                dispatch({ type: 'updateMagazine', id: g.magazine.id, patch: { name } })
              }
              onDelete={() => dispatch({ type: 'deleteMagazine', id: g.magazine.id })}
            >
              {g.articles.length === 0 ? (
                <p className="text-sm text-ink-700/40 dark:text-ink-100/40 py-3">
                  该标签下没有文章
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {g.articles.map((a) => (
                    <ArticleCard
                      key={a.id}
                      article={a}
                      draggable={!tagFilter}
                      onDragStart={() => setDragId(a.id)}
                      onDrop={() => handleDrop(a.id)}
                      onOpen={() =>
                        dispatch({
                          type: 'navigate',
                          route: { page: 'reader', articleId: a.id },
                        })
                      }
                      onToggleStar={() =>
                        dispatch({
                          type: 'updateArticle',
                          id: a.id,
                          patch: { starred: !a.starred },
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </MagazineSection>
          ))}
        </div>
      )}

      {uploadOpen && (
        <UploadModal defaultWeekKey={weekKey} onClose={() => setUploadOpen(false)} />
      )}
    </div>
  )
}

// 周刊分区:可折叠的分组标题(改名 / 删除 / 篇数),文章卡片归属各自周刊
function MagazineSection({ magazine, total, filtered, onRename, onDelete, children }) {
  const [collapsed, setCollapsed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(magazine.name)

  return (
    <section className="border border-ink-200 dark:border-ink-700 rounded-2xl overflow-hidden">
      <div className="group flex items-center gap-2 px-4 py-3 bg-ink-50/70 dark:bg-ink-800/50">
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="text-ink-700/50 dark:text-ink-100/50 w-5 text-left"
          title={collapsed ? '展开' : '收起'}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        {editing ? (
          <input
            autoFocus
            className="flex-1 min-w-0 rounded-md border border-ink-300 dark:border-ink-600 bg-transparent px-2 py-0.5 text-sm font-medium"
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
        ) : (
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="flex-1 min-w-0 text-left text-sm font-medium truncate"
          >
            📰 {magazine.name}
            <span className="ml-2 text-xs font-normal text-ink-700/40 dark:text-ink-100/40">
              {total} 篇{filtered ? '(筛选中)' : ''}
            </span>
          </button>
        )}
        <button
          title="重命名"
          onClick={() => {
            setValue(magazine.name)
            setEditing(true)
          }}
          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-sm"
        >
          ✏️
        </button>
        <button
          title="删除这份周刊"
          onClick={() => {
            if (
              window.confirm(
                `确定删除「${magazine.name}」吗?\n将同时删除其中 ${total} 篇文章及相关笔记、生词。此操作不可恢复。`
              )
            ) {
              onDelete()
            }
          }}
          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-sm"
        >
          🗑️
        </button>
      </div>
      {!collapsed && <div className="p-3">{children}</div>}
    </section>
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
          {magazine ? `${magazine} · ` : ''}读 {article.readMinutes} 分 / 听 {article.listenMinutes} 分
        </span>
      </div>
    </div>
  )
}
