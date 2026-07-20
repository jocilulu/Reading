// 上传周刊:选择来源 → 解析 → 拆分结果确认(可合并/再拆分)→ 保存
import React, { useState } from 'react'
import { useStore } from '../../store/AppStore'
import {
  extractTextFromFile,
  extractTextFromUrl,
  smartSplit,
  heuristicSplit,
  finalizeArticle,
} from '../../lib/parse'
import { summarizeArticle, llmConfigured } from '../../lib/llm'
import { splitSentences, detectLanguage, uid, weekKeyOf, shiftWeekKey, weekLabel } from '../../lib/utils'

export default function UploadModal({ defaultWeekKey, onClose }) {
  const { dispatch } = useStore()
  const [step, setStep] = useState('form') // form | parsing | review
  const [weekKey, setWeekKey] = useState(defaultWeekKey || weekKeyOf())
  const [name, setName] = useState('')
  const [sourceType, setSourceType] = useState('file') // file | url | paste
  const [url, setUrl] = useState('')
  const [pasted, setPasted] = useState('')
  const [file, setFile] = useState(null)
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState([])
  const [useAI, setUseAI] = useState(llmConfigured())

  const parse = async () => {
    setError('')
    setStep('parsing')
    try {
      let text = ''
      if (sourceType === 'file') {
        if (!file) throw new Error('请选择文件')
        text = await extractTextFromFile(file)
        if (!name) setName(file.name.replace(/\.\w+$/, ''))
      } else if (sourceType === 'url') {
        if (!url.trim()) throw new Error('请输入链接')
        text = await extractTextFromUrl(url.trim())
      } else {
        text = pasted
      }
      text = (text || '').trim()
      if (text.length < 20) throw new Error('未能提取到有效文本')
      const result = useAI ? await smartSplit(text) : heuristicSplit(text)
      setDrafts(result.map((d) => ({ ...d, _key: uid('d') })))
      setStep('review')
    } catch (e) {
      console.error(e)
      setError(
        sourceType === 'url'
          ? `${e.message}(网页可能限制跨域抓取,可改用复制粘贴)`
          : e.message
      )
      setStep('form')
    }
  }

  const mergeUp = (i) => {
    if (i === 0) return
    setDrafts((ds) => {
      const next = [...ds]
      const merged = {
        ...next[i - 1],
        paragraphs: [
          ...next[i - 1].paragraphs,
          ...(next[i].title ? [next[i].title] : []),
          ...next[i].paragraphs,
        ],
      }
      next.splice(i - 1, 2, merged)
      return next
    })
  }

  const splitAt = (i, paraIndex) => {
    if (paraIndex === 0) return
    setDrafts((ds) => {
      const next = [...ds]
      const d = next[i]
      const first = { ...d, paragraphs: d.paragraphs.slice(0, paraIndex) }
      const second = {
        _key: uid('d'),
        title: d.paragraphs[paraIndex].slice(0, 40),
        author: '',
        paragraphs: d.paragraphs.slice(paraIndex + 1),
      }
      if (!second.paragraphs.length) return ds
      next.splice(i, 1, first, second)
      return next
    })
  }

  const removeDraft = (i) => {
    setDrafts((ds) => ds.filter((_, idx) => idx !== i))
  }

  const confirm = () => {
    const magazine = {
      id: uid('m'),
      weekKey,
      name: name.trim() || '未命名周刊',
      sourceType,
      createdAt: Date.now(),
    }
    const articles = drafts
      .filter((d) => d.paragraphs.length)
      .map((d, i) =>
        finalizeArticle(d, { magazineId: magazine.id, weekKey, order: i })
      )
    dispatch({ type: 'addMagazine', magazine, articles })
    onClose()

    // 后台生成摘要与标签(不阻塞界面)
    if (llmConfigured()) {
      for (const a of articles) {
        summarizeArticle({ title: a.title, content: a.paragraphs.join('\n') })
          .then((res) =>
            dispatch({
              type: 'updateArticle',
              id: a.id,
              patch: { summary: res.summary, tags: res.tags.slice(0, 3) },
            })
          )
          .catch((e) => console.warn('摘要生成失败', a.title, e))
      }
    } else {
      for (const a of articles) {
        const firstSentence = splitSentences(
          a.paragraphs[0] || '',
          detectLanguage(a.paragraphs[0] || '')
        )[0]
        dispatch({
          type: 'updateArticle',
          id: a.id,
          patch: { summary: (firstSentence || '').slice(0, 50) },
        })
      }
    }
  }

  const weekOptions = [-2, -1, 0].map((d) => shiftWeekKey(weekKeyOf(), d)).reverse()

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-ink-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[88vh] flex flex-col">
        <div className="px-6 py-4 border-b border-ink-100 dark:border-ink-700 flex items-center justify-between">
          <h2 className="font-semibold">
            {step === 'review' ? '确认拆分结果' : '上传周刊'}
          </h2>
          <button onClick={onClose} className="text-ink-700/50 hover:text-ink-700 dark:text-ink-100/60">
            ✕
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {step === 'form' && (
            <div className="space-y-4">
              <div className="flex gap-3">
                <label className="block text-sm flex-1">
                  归属周
                  <select
                    className="mt-1 w-full rounded-md border border-ink-200 dark:border-ink-700 bg-transparent px-2 py-1.5 text-sm dark:bg-ink-800"
                    value={weekKey}
                    onChange={(e) => setWeekKey(e.target.value)}
                  >
                    {[...new Set([weekKey, ...weekOptions])].map((k) => (
                      <option key={k} value={k}>
                        {weekLabel(k)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm flex-1">
                  周刊名称
                  <input
                    className="mt-1 w-full rounded-md border border-ink-200 dark:border-ink-700 bg-transparent px-2 py-1.5 text-sm"
                    placeholder="如:经济学人 / 少数派"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              </div>

              <div className="flex gap-2 text-sm">
                {[
                  ['file', '📄 文件(PDF/EPUB/TXT)'],
                  ['url', '🔗 网页链接'],
                  ['paste', '📋 粘贴文本'],
                ].map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setSourceType(k)}
                    className={`px-3 py-1.5 rounded-md border ${
                      sourceType === k
                        ? 'border-ink-800 dark:border-ink-100 font-medium'
                        : 'border-ink-200 dark:border-ink-700 text-ink-700/60 dark:text-ink-100/60'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {sourceType === 'file' && (
                <input
                  type="file"
                  accept=".pdf,.epub,.txt,.md"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="block text-sm"
                />
              )}
              {sourceType === 'url' && (
                <input
                  className="w-full rounded-md border border-ink-200 dark:border-ink-700 bg-transparent px-2 py-1.5 text-sm"
                  placeholder="https://…"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              )}
              {sourceType === 'paste' && (
                <textarea
                  rows={8}
                  className="w-full rounded-md border border-ink-200 dark:border-ink-700 bg-transparent px-2 py-1.5 text-sm"
                  placeholder="把周刊全文粘贴到这里…"
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                />
              )}

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={useAI}
                  onChange={(e) => setUseAI(e.target.checked)}
                  disabled={!llmConfigured()}
                />
                用 AI 辅助识别文章边界
                {!llmConfigured() && (
                  <span className="text-xs text-ink-700/50">(需先在设置里配置 API Key)</span>
                )}
              </label>

              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
          )}

          {step === 'parsing' && (
            <div className="py-16 text-center text-sm text-ink-700/60 dark:text-ink-100/60">
              正在解析并拆分文章…
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-4">
              <p className="text-sm text-ink-700/60 dark:text-ink-100/60">
                共识别出 {drafts.length} 篇文章。可修改标题/作者、向上合并、或点击段落前的 ✂️ 从该段拆出新文章。
              </p>
              {drafts.map((d, i) => (
                <DraftEditor
                  key={d._key}
                  draft={d}
                  index={i}
                  onChange={(patch) =>
                    setDrafts((ds) => ds.map((x, xi) => (xi === i ? { ...x, ...patch } : x)))
                  }
                  onMergeUp={() => mergeUp(i)}
                  onSplitAt={(pi) => splitAt(i, pi)}
                  onRemove={() => removeDraft(i)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-ink-100 dark:border-ink-700 flex justify-end gap-2">
          {step === 'form' && (
            <button
              onClick={parse}
              className="px-4 py-1.5 rounded-md text-sm bg-ink-800 text-white dark:bg-ink-100 dark:text-ink-900 hover:opacity-90"
            >
              解析并拆分
            </button>
          )}
          {step === 'review' && (
            <>
              <button
                onClick={() => setStep('form')}
                className="px-3 py-1.5 rounded-md text-sm hover:bg-ink-100 dark:hover:bg-ink-700"
              >
                返回
              </button>
              <button
                onClick={confirm}
                disabled={!drafts.length}
                className="px-4 py-1.5 rounded-md text-sm bg-ink-800 text-white dark:bg-ink-100 dark:text-ink-900 hover:opacity-90 disabled:opacity-40"
              >
                确认保存 {drafts.length} 篇文章
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function DraftEditor({ draft, index, onChange, onMergeUp, onSplitAt, onRemove }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="border border-ink-200 dark:border-ink-700 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-ink-700/40 dark:text-ink-100/40 w-6">{index + 1}.</span>
        <input
          className="flex-1 rounded border border-transparent hover:border-ink-200 dark:hover:border-ink-700 bg-transparent px-1 py-0.5 text-sm font-medium"
          value={draft.title}
          placeholder="文章标题"
          onChange={(e) => onChange({ title: e.target.value })}
        />
        <input
          className="w-28 rounded border border-transparent hover:border-ink-200 dark:hover:border-ink-700 bg-transparent px-1 py-0.5 text-xs"
          value={draft.author}
          placeholder="作者(可选)"
          onChange={(e) => onChange({ author: e.target.value })}
        />
      </div>
      <div className="flex gap-3 text-xs text-ink-700/60 dark:text-ink-100/60">
        <span>{draft.paragraphs.length} 段</span>
        <button className="hover:underline" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '收起段落' : '查看段落 / 再拆分'}
        </button>
        {index > 0 && (
          <button className="hover:underline" onClick={onMergeUp}>
            ⬆ 并入上一篇
          </button>
        )}
        <button className="hover:underline text-red-500/80" onClick={onRemove}>
          删除
        </button>
      </div>
      {expanded && (
        <div className="space-y-1 max-h-64 overflow-y-auto border-t border-ink-100 dark:border-ink-700 pt-2">
          {draft.paragraphs.map((p, pi) => (
            <div key={pi} className="flex gap-1.5 text-xs leading-relaxed group">
              {pi > 0 ? (
                <button
                  title="从此段拆出新文章"
                  onClick={() => onSplitAt(pi)}
                  className="opacity-0 group-hover:opacity-100 shrink-0"
                >
                  ✂️
                </button>
              ) : (
                <span className="w-4 shrink-0" />
              )}
              <p className="text-ink-700/70 dark:text-ink-100/70">
                {p.length > 160 ? p.slice(0, 160) + '…' : p}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
