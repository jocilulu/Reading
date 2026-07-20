// 我的笔记:所有高亮、批注、文章速记,按 周 → 周刊 → 文章 分组,可一键跳回原文
import React from 'react'
import { marked } from 'marked'
import { useStore, magazineName } from '../../store/AppStore'
import { weekLabel, classNames } from '../../lib/utils'

export default function NotesPage() {
  const { state, dispatch } = useStore()

  // 收集:每篇文章的高亮 + 速记
  const perArticle = new Map()
  for (const h of state.highlights) {
    if (!perArticle.has(h.articleId)) perArticle.set(h.articleId, { highlights: [], note: null })
    perArticle.get(h.articleId).highlights.push(h)
  }
  for (const [articleId, note] of Object.entries(state.articleNotes)) {
    if (!perArticle.has(articleId)) perArticle.set(articleId, { highlights: [], note: null })
    perArticle.get(articleId).note = note
  }

  const articles = state.articles.filter((a) => perArticle.has(a.id))
  if (!articles.length) {
    return (
      <div className="text-center py-24 text-ink-700/40 dark:text-ink-100/40 text-sm">
        还没有任何笔记。在阅读页选中文字即可高亮或批注,按 N 打开速记侧栏。
      </div>
    )
  }

  // 周 → 周刊 → 文章
  const byWeek = new Map()
  for (const a of articles) {
    if (!byWeek.has(a.weekKey)) byWeek.set(a.weekKey, new Map())
    const byMag = byWeek.get(a.weekKey)
    if (!byMag.has(a.magazineId)) byMag.set(a.magazineId, [])
    byMag.get(a.magazineId).push(a)
  }
  const weeks = [...byWeek.keys()].sort().reverse()

  const jump = (articleId, sentenceId) =>
    dispatch({
      type: 'navigate',
      route: { page: 'reader', articleId, targetSentence: sentenceId || null },
    })

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
      <h1 className="text-2xl font-semibold">我的笔记</h1>
      {weeks.map((wk) => (
        <section key={wk}>
          <h2 className="text-lg font-medium mb-3">{weekLabel(wk)}</h2>
          {[...byWeek.get(wk).entries()].map(([magId, arts]) => (
            <div key={magId} className="mb-4">
              <h3 className="text-sm text-ink-700/50 dark:text-ink-100/50 mb-2">
                {magazineName(state, magId)}
              </h3>
              <div className="space-y-3">
                {arts.map((a) => {
                  const data = perArticle.get(a.id)
                  return (
                    <div
                      key={a.id}
                      className="border border-ink-200 dark:border-ink-700 rounded-xl p-4"
                    >
                      <button
                        onClick={() => jump(a.id)}
                        className="font-medium hover:underline mb-2 block text-left"
                      >
                        {a.title}
                      </button>
                      <div className="space-y-2">
                        {data.highlights.map((h) => (
                          <button
                            key={h.id}
                            onClick={() => jump(a.id, h.segs[0]?.sentenceId)}
                            className="w-full text-left text-sm group"
                            title="跳回原文"
                          >
                            <span
                              className={classNames(
                                `hl-${h.color}`,
                                'px-1 rounded-sm leading-relaxed'
                              )}
                            >
                              {h.text}
                            </span>
                            {h.note && (
                              <span className="block mt-0.5 pl-2 border-l-2 border-ink-200 dark:border-ink-700 text-ink-700/70 dark:text-ink-100/70">
                                💬 {h.note}
                              </span>
                            )}
                            <span className="opacity-0 group-hover:opacity-100 text-xs text-ink-700/40 dark:text-ink-100/40 ml-1">
                              ↩ 跳回原文
                            </span>
                          </button>
                        ))}
                        {data.note && (
                          <div className="text-sm bg-ink-50 dark:bg-ink-800/60 rounded-lg p-3">
                            <div className="text-xs text-ink-700/40 dark:text-ink-100/40 mb-1">
                              📝 文章速记
                            </div>
                            <div
                              className="md-preview"
                              dangerouslySetInnerHTML={{
                                __html: marked.parse(data.note.text, { breaks: true }),
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
