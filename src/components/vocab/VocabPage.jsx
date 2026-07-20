// 生词本:按周刊分组,保留出处句子,可标记已掌握、跳回原文
import React, { useState } from 'react'
import { useStore, magazineName } from '../../store/AppStore'
import { weekLabel, classNames } from '../../lib/utils'

export default function VocabPage() {
  const { state, dispatch } = useStore()
  const [showMastered, setShowMastered] = useState(true)

  const vocab = state.vocab.filter((v) => showMastered || !v.mastered)
  if (!state.vocab.length) {
    return (
      <div className="text-center py-24 text-ink-700/40 dark:text-ink-100/40 text-sm">
        生词本还是空的。阅读外文文章时,单击任意单词即可查询并收藏。
      </div>
    )
  }

  // 周刊(magazine)分组,按周倒序
  const byMag = new Map()
  for (const v of vocab) {
    if (!byMag.has(v.magazineId)) byMag.set(v.magazineId, [])
    byMag.get(v.magazineId).push(v)
  }
  const magIds = [...byMag.keys()].sort((a, b) => {
    const wa = state.magazines.find((m) => m.id === a)?.weekKey || ''
    const wb = state.magazines.find((m) => m.id === b)?.weekKey || ''
    return wb.localeCompare(wa)
  })

  const masteredCount = state.vocab.filter((v) => v.mastered).length

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">生词本</h1>
        <label className="text-sm flex items-center gap-2 text-ink-700/60 dark:text-ink-100/60">
          <input
            type="checkbox"
            checked={showMastered}
            onChange={(e) => setShowMastered(e.target.checked)}
          />
          显示已掌握({masteredCount})
        </label>
      </div>

      {magIds.map((magId) => {
        const mag = state.magazines.find((m) => m.id === magId)
        const words = byMag.get(magId)
        return (
          <section key={magId}>
            <h2 className="text-sm text-ink-700/50 dark:text-ink-100/50 mb-2">
              {mag ? `${weekLabel(mag.weekKey)} · ${mag.name}` : '未知周刊'}(
              {words.length})
            </h2>
            <div className="space-y-2">
              {words.map((v) => (
                <div
                  key={v.id}
                  className={classNames(
                    'border border-ink-200 dark:border-ink-700 rounded-xl p-4',
                    v.mastered && 'opacity-50'
                  )}
                >
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="font-semibold">{v.word}</span>
                    {v.phonetic && (
                      <span className="text-xs text-ink-700/50 dark:text-ink-100/50">
                        {v.phonetic}
                      </span>
                    )}
                    {v.baseMeaning && (
                      <span className="text-sm text-ink-700/70 dark:text-ink-100/70">
                        {v.baseMeaning}
                      </span>
                    )}
                    <div className="ml-auto flex gap-2 text-xs shrink-0">
                      <button
                        onClick={() =>
                          dispatch({
                            type: 'updateVocab',
                            id: v.id,
                            patch: { mastered: !v.mastered },
                          })
                        }
                        className={classNames(
                          'px-2 py-0.5 rounded border',
                          v.mastered
                            ? 'border-green-400 text-green-600 dark:text-green-400'
                            : 'border-ink-200 dark:border-ink-700 hover:bg-ink-100 dark:hover:bg-ink-700'
                        )}
                      >
                        {v.mastered ? '✓ 已掌握' : '标记掌握'}
                      </button>
                      <button
                        onClick={() => dispatch({ type: 'deleteVocab', id: v.id })}
                        className="px-2 py-0.5 rounded border border-ink-200 dark:border-ink-700 text-red-500/80 hover:bg-red-50 dark:hover:bg-red-500/10"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  {v.contextMeaning && (
                    <p className="text-sm mb-1">语境:{v.contextMeaning}</p>
                  )}
                  <button
                    onClick={() =>
                      dispatch({
                        type: 'navigate',
                        route: {
                          page: 'reader',
                          articleId: v.articleId,
                          targetSentence: v.sentenceId,
                        },
                      })
                    }
                    className="text-sm text-ink-700/50 dark:text-ink-100/50 italic text-left hover:underline"
                    title="跳回原文"
                  >
                    “{v.sentence}”
                  </button>
                  {v.example && (
                    <p className="text-sm text-ink-700/60 dark:text-ink-100/60 mt-1">
                      例:{v.example}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
