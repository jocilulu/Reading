// 生词点击解释弹卡:词典释义 + 语境含义 + 例句 + 加入生词本
import React, { useEffect, useRef, useState } from 'react'
import { lookupWord } from '../../lib/dict'

export default function WordPopover({ query, onClose, onAddVocab, alreadyAdded }) {
  // query: { word, sentence, sentenceId, articleId, language, x, y }
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const ref = useRef(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setResult(null)
    lookupWord(query).then((r) => {
      if (!alive) return
      setResult(r)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [query.word, query.sentenceId])

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // 位置:避免超出视口
  const style = {
    left: Math.min(query.x, window.innerWidth - 340),
    top: Math.min(query.y + 12, window.innerHeight - 320),
  }

  const dict = result?.dictionary
  const llm = result?.llm

  return (
    <div
      ref={ref}
      style={style}
      className="fixed z-40 w-80 bg-white dark:bg-ink-800 rounded-xl shadow-2xl border border-ink-200 dark:border-ink-700 p-4 text-sm"
    >
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <span className="font-semibold text-base">{query.word}</span>
          {dict?.phonetic && (
            <span className="ml-2 text-xs text-ink-700/50 dark:text-ink-100/50">
              {dict.phonetic}
            </span>
          )}
        </div>
        <button
          onClick={() => onAddVocab(result)}
          disabled={alreadyAdded}
          className="text-xs px-2 py-1 rounded-md bg-ink-800 text-white dark:bg-ink-100 dark:text-ink-900 hover:opacity-90 disabled:opacity-40"
        >
          {alreadyAdded ? '已在生词本' : '+ 加入生词本'}
        </button>
      </div>

      {loading && (
        <p className="text-ink-700/40 dark:text-ink-100/40 py-3 animate-pulse">查询中…</p>
      )}

      {!loading && (
        <div className="space-y-2.5 max-h-64 overflow-y-auto">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-ink-700/40 dark:text-ink-100/40 mb-0.5">
              词典释义
            </div>
            {llm?.baseMeaning && <p>{llm.baseMeaning}</p>}
            {dict?.meanings?.length ? (
              dict.meanings.map((m, i) => (
                <p key={i} className="text-ink-700/80 dark:text-ink-100/80">
                  <span className="italic text-ink-700/50 dark:text-ink-100/50">
                    {m.partOfSpeech}.
                  </span>{' '}
                  {m.definition}
                </p>
              ))
            ) : !llm?.baseMeaning ? (
              <p className="text-ink-700/40 dark:text-ink-100/40">未找到词典释义</p>
            ) : null}
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wide text-ink-700/40 dark:text-ink-100/40 mb-0.5">
              语境含义
            </div>
            {llm?.contextMeaning ? (
              <p>{llm.contextMeaning}</p>
            ) : result?.llmError === 'not-configured' ? (
              <p className="text-ink-700/40 dark:text-ink-100/40">
                配置 LLM API 后可获取语境释义
              </p>
            ) : (
              <p className="text-ink-700/40 dark:text-ink-100/40">
                获取失败{result?.llmError ? `:${result.llmError}` : ''}
              </p>
            )}
          </div>

          {(llm?.example || dict?.meanings?.find((m) => m.example)) && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-ink-700/40 dark:text-ink-100/40 mb-0.5">
                例句
              </div>
              <p className="italic text-ink-700/70 dark:text-ink-100/70">
                {llm?.example || dict.meanings.find((m) => m.example)?.example}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
