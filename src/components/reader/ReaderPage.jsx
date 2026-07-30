// 文章阅读页:正文排版、TTS 边听边看、划线批注、生词点击、速记侧栏
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useStore, magazineName, makeVocabEntry, articlesOfWeek } from '../../store/AppStore'
import { splitSentences, uid, classNames, languageLabel } from '../../lib/utils'
import { SentencePlayer } from '../../lib/tts'
import { translateParagraphs, llmConfigured } from '../../lib/llm'
import { fileCacheGet } from '../../lib/storage'
import AudioPlayer from './AudioPlayer'
import WordPopover from './WordPopover'
import NotesSidebar from './NotesSidebar'

const HL_COLORS = [
  { key: 'yellow', cls: 'hl-yellow', dot: 'bg-yellow-300' },
  { key: 'green', cls: 'hl-green', dot: 'bg-green-300' },
  { key: 'pink', cls: 'hl-pink', dot: 'bg-pink-300' },
]

export default function ReaderPage() {
  const { state, dispatch } = useStore()
  const articleId = state.route.articleId
  const article = state.articles.find((a) => a.id === articleId)
  const containerRef = useRef(null)
  const playerRef = useRef(null)
  const accumRef = useRef(0)

  const [playerState, setPlayerState] = useState('idle')
  const [activeIdx, setActiveIdx] = useState(-1)
  const [wordQuery, setWordQuery] = useState(null)
  const [selToolbar, setSelToolbar] = useState(null) // { x, y, segs, text }
  const [hlEditor, setHlEditor] = useState(null) // { hlId, x, y }
  const [notesOpen, setNotesOpen] = useState(false)
  // 阅读模式:original 原文 / zh 中文 / both 对照(外文文章有效,偏好会记住)
  const [viewMode, setViewModeState] = useState(
    () => state.settings.readerMode || 'original'
  )
  const [blurTrans, setBlurTrans] = useState(false) // 对照模式:中文悬停显示
  const [transState, setTransState] = useState(null) // null | {done,total} | {error}
  const [pdfOpen, setPdfOpen] = useState(false)
  const [pdfUrl, setPdfUrl] = useState(null)

  const setViewMode = (mode) => {
    setViewModeState(mode)
    dispatch({ type: 'updateSettings', patch: { readerMode: mode } })
  }

  // 中文译文是否已完整
  const zhReady = Boolean(
    article &&
      (article.translation || []).length === article.paragraphs.length &&
      (article.translation || []).every(Boolean)
  )
  const usingZh = viewMode === 'zh' && zhReady && article?.language !== 'zh'
  const bilingual = viewMode === 'both' && article?.language !== 'zh'

  // ---- 句子模型(中文模式下基于译文构建,朗读用中文)----
  const model = useMemo(() => {
    if (!article) return null
    const sourceParas = usingZh ? article.translation : article.paragraphs
    const lang = usingZh ? 'zh' : article.language
    const prefix = usingZh ? 't' : '' // 译文句子用独立 id,避免与原文的高亮锚点混淆
    const paras = sourceParas.map((p, pi) => ({
      pi,
      sentences: splitSentences(p, lang).map((text, si) => ({
        id: `${prefix}p${pi}s${si}`,
        text,
        pi,
      })),
    }))
    const flat = paras.flatMap((p) => p.sentences)
    const indexById = new Map(flat.map((s, i) => [s.id, i]))
    return { paras, flat, indexById, lang }
  }, [article?.id, usingZh])

  const flushListening = useCallback(() => {
    if (accumRef.current >= 1) {
      dispatch({ type: 'addListening', seconds: Math.round(accumRef.current) })
      accumRef.current = 0
    }
  }, [dispatch])

  // ---- 播放器 ----
  useEffect(() => {
    if (!model || !article) return
    const player = new SentencePlayer({
      sentences: model.flat,
      lang: model.lang,
      onSentence: (i) => setActiveIdx(i),
      onTick: (dt) => {
        accumRef.current += dt
        if (accumRef.current >= 5) flushListening()
      },
      onState: (s) => {
        setPlayerState(s)
        if (s === 'paused' || s === 'ended' || s === 'idle') flushListening()
        if (s === 'ended') {
          dispatch({ type: 'updateArticle', id: article.id, patch: { listenedDone: true } })
        }
      },
    })
    playerRef.current = player
    return () => {
      flushListening()
      player.destroy()
      playerRef.current = null
    }
  }, [model, article?.id])

  // 打开文章 → 未读变阅读中
  useEffect(() => {
    if (article && article.status === 'unread') {
      dispatch({ type: 'updateArticle', id: article.id, patch: { status: 'reading' } })
    }
  }, [article?.id])

  // 从笔记页跳转过来 → 滚动定位并闪烁
  useEffect(() => {
    const target = state.route.targetSentence
    if (!target) return
    const t = setTimeout(() => {
      const el = containerRef.current?.querySelector(`[data-sid="${target}"]`)
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        el.classList.add('flash-target')
      }
    }, 100)
    return () => clearTimeout(t)
  }, [state.route.targetSentence, article?.id])

  // 播放中自动滚动跟随
  useEffect(() => {
    if (activeIdx < 0 || !model) return
    const s = model.flat[activeIdx]
    const el = containerRef.current?.querySelector(`[data-sid="${s.id}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeIdx])

  // 快捷键 N:开关速记侧栏
  useEffect(() => {
    const handler = (e) => {
      if (e.key.toLowerCase() !== 'n') return
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return
      setNotesOpen((v) => !v)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // PDF 原版面板:打开时从 IndexedDB 取出原件生成 blob URL
  useEffect(() => {
    let url = null
    if (pdfOpen && article) {
      fileCacheGet('src-' + article.magazineId).then((blob) => {
        if (blob) {
          url = URL.createObjectURL(blob)
          setPdfUrl(url)
        } else {
          setPdfUrl('missing')
        }
      })
    } else {
      setPdfUrl(null)
    }
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [pdfOpen, article?.magazineId])

  if (!article || !model) {
    return (
      <div className="py-24 text-center text-sm text-ink-700/40">文章不存在</div>
    )
  }

  // ---- 翻译:按段落分块调用 LLM,结果持久化到文章记录 ----
  const startTranslation = async () => {
    if (!llmConfigured()) {
      setTransState({ error: '未配置 API Key,请先到「设置」填写' })
      return
    }
    const paras = article.paragraphs
    const filled = [...(article.translation || new Array(paras.length).fill(null))]
    while (filled.length < paras.length) filled.push(null)
    setTransState({ done: filled.filter(Boolean).length, total: paras.length })
    try {
      // 每块累计不超过 ~3500 字符,顺序翻译,边译边存
      let i = filled.findIndex((t) => !t)
      if (i < 0) i = paras.length
      while (i < paras.length) {
        const chunk = []
        let chars = 0
        const start = i
        while (i < paras.length && (chunk.length === 0 || chars < 3500)) {
          chunk.push(paras[i])
          chars += paras[i].length
          i++
        }
        const out = await translateParagraphs(chunk)
        out.forEach((t, k) => {
          filled[start + k] = t
        })
        dispatch({
          type: 'updateArticle',
          id: article.id,
          patch: { translation: [...filled] },
        })
        setTransState({ done: filled.filter(Boolean).length, total: paras.length })
      }
      setTransState(null)
    } catch (e) {
      console.error('翻译失败', e)
      setTransState({ error: e?.message || String(e) })
    }
  }

  const translatingRef = useRef(false)
  // 进入中文/对照模式时,若译文不全则自动开始翻译
  useEffect(() => {
    const needZh =
      article &&
      article.language !== 'zh' &&
      (viewMode === 'zh' || viewMode === 'both') &&
      !zhReady
    if (needZh && !translatingRef.current && llmConfigured()) {
      translatingRef.current = true
      startTranslation().finally(() => {
        translatingRef.current = false
      })
    } else if (needZh && !llmConfigured()) {
      setTransState({ error: '未配置 API Key,请先到「设置」填写' })
    }
  }, [viewMode, article?.id, zhReady])

  const lang = article.language
  const isForeign = lang !== 'zh'
  // 正在展示的主栏是否为外文(中文模式下主栏是译文,不启用查词分词)
  const displayForeign = isForeign && !usingZh
  const activeSentenceId = activeIdx >= 0 ? model.flat[activeIdx]?.id : null
  const zhPending = viewMode === 'zh' && isForeign && !zhReady

  // sentenceId -> 高亮片段
  const segsBySentence = new Map()
  for (const h of state.highlights) {
    if (h.articleId !== article.id) continue
    for (const seg of h.segs) {
      if (!segsBySentence.has(seg.sentenceId)) segsBySentence.set(seg.sentenceId, [])
      segsBySentence.get(seg.sentenceId).push({ ...seg, color: h.color, hlId: h.id })
    }
  }

  // ---- 选区 → 高亮 ----
  const handleMouseUp = () => {
    setTimeout(() => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || !containerRef.current) {
        setSelToolbar(null)
        return
      }
      const range = sel.getRangeAt(0)
      if (!containerRef.current.contains(range.commonAncestorContainer)) return
      const segs = []
      containerRef.current.querySelectorAll('[data-sid]').forEach((el) => {
        if (!range.intersectsNode(el)) return
        const len = el.textContent.length
        let start = 0
        let end = len
        if (el.contains(range.startContainer)) {
          const pre = document.createRange()
          pre.selectNodeContents(el)
          pre.setEnd(range.startContainer, range.startOffset)
          start = pre.toString().length
        }
        if (el.contains(range.endContainer)) {
          const pre = document.createRange()
          pre.selectNodeContents(el)
          pre.setEnd(range.endContainer, range.endOffset)
          end = pre.toString().length
        }
        if (end > start) segs.push({ sentenceId: el.dataset.sid, start, end })
      })
      if (!segs.length) return
      const rect = range.getBoundingClientRect()
      setSelToolbar({
        x: rect.left + rect.width / 2,
        y: rect.top,
        segs,
        text: sel.toString().slice(0, 200),
      })
    }, 10)
  }

  const applyHighlight = (color, withNote) => {
    if (!selToolbar) return
    const hl = {
      id: uid('h'),
      articleId: article.id,
      color,
      note: '',
      text: selToolbar.text,
      segs: selToolbar.segs,
      createdAt: Date.now(),
    }
    dispatch({ type: 'addHighlight', highlight: hl })
    window.getSelection()?.removeAllRanges()
    if (withNote) {
      setHlEditor({ hlId: hl.id, x: selToolbar.x, y: selToolbar.y + 30 })
    }
    setSelToolbar(null)
  }

  // ---- 句子点击:词卡 or 从此句播放 ----
  const handleSentenceClick = (e, sentence) => {
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return // 正在划选,忽略点击
    const word = e.target.dataset?.word
    if (word && displayForeign) {
      setWordQuery({
        word,
        sentence: sentence.text,
        sentenceId: sentence.id,
        articleId: article.id,
        language: languageLabel(lang) === '英文' ? 'English' : lang,
        x: e.clientX,
        y: e.clientY,
      })
      return
    }
    const hlId = e.target.dataset?.hl
    if (hlId) {
      setHlEditor({ hlId, x: e.clientX, y: e.clientY + 10 })
      return
    }
    // 点击句子空白处 → 从该句开始播放
    const idx = model.indexById.get(sentence.id)
    if (idx !== undefined) playerRef.current?.play(idx)
  }

  const addVocabFromPopover = (result) => {
    if (!wordQuery) return
    const llm = result?.llm
    const dict = result?.dictionary
    dispatch({
      type: 'addVocab',
      entry: makeVocabEntry({
        word: wordQuery.word,
        articleId: article.id,
        magazineId: article.magazineId,
        weekKey: article.weekKey,
        sentence: wordQuery.sentence,
        sentenceId: wordQuery.sentenceId,
        phonetic: dict?.phonetic || '',
        baseMeaning:
          llm?.baseMeaning ||
          (dict?.meanings?.[0]
            ? `${dict.meanings[0].partOfSpeech}. ${dict.meanings[0].definition}`
            : ''),
        contextMeaning: llm?.contextMeaning || '',
        example: llm?.example || dict?.meanings?.find((m) => m.example)?.example || '',
      }),
    })
    setWordQuery(null)
  }

  const notesByPara = new Map()
  for (const h of state.highlights) {
    if (h.articleId !== article.id || !h.note) continue
    const m = /^t?p(\d+)s/.exec(h.segs[0]?.sentenceId || '')
    if (!m) continue
    const pi = Number(m[1])
    if (!notesByPara.has(pi)) notesByPara.set(pi, [])
    notesByPara.get(pi).push(h)
  }

  const editingHl = hlEditor ? state.highlights.find((h) => h.id === hlEditor.hlId) : null
  const noteText = state.articleNotes[article.id]?.text || ''
  const magazine = state.magazines.find((m) => m.id === article.magazineId)
  const translation = article.translation || []

  return (
    <div className="flex h-full">
      {/* 左侧:PDF 原版面板(浏览器原生查看器,含图片,可缩放翻页) */}
      {pdfOpen && (
        <div className="hidden md:flex flex-col w-[42%] shrink-0 border-r border-ink-100 dark:border-ink-800">
          <div className="flex items-center justify-between px-3 py-2 border-b border-ink-100 dark:border-ink-800 text-xs text-ink-700/60 dark:text-ink-100/60">
            <span>📄 {magazine?.sourceName || '原版 PDF'}</span>
            <button onClick={() => setPdfOpen(false)} className="hover:text-ink-700 dark:hover:text-ink-100">
              ✕ 关闭
            </button>
          </div>
          {pdfUrl === 'missing' ? (
            <div className="flex-1 flex items-center justify-center text-sm text-ink-700/40 dark:text-ink-100/40 px-6 text-center">
              没有找到这份周刊的 PDF 原件(只有以 PDF 文件上传的周刊才会保留原版)
            </div>
          ) : pdfUrl ? (
            <iframe title="原版 PDF" src={pdfUrl} className="flex-1 w-full" />
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-ink-700/40 animate-pulse">
              加载中…
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* 吸顶区:播放器 + 阅读模式切换(随时可切,无需滚回顶部) */}
        <div className="shrink-0 z-20 bg-white/95 dark:bg-ink-900/95 backdrop-blur">
          <AudioPlayer
            player={playerRef.current}
            playerState={playerState}
            sentenceIndex={Math.max(activeIdx, 0)}
            sentenceCount={model.flat.length}
          />
          {(isForeign || magazine?.hasPdf) && (
            <div className="border-b border-ink-100 dark:border-ink-800">
              <div
                className={classNames(
                  'mx-auto px-4 py-1.5 flex flex-wrap items-center gap-2 text-xs',
                  bilingual ? 'max-w-5xl' : 'max-w-article'
                )}
              >
                {isForeign && (
                  <div className="flex rounded-full border border-ink-200 dark:border-ink-700 overflow-hidden">
                    {[
                      ['original', '原文'],
                      ['zh', '中文'],
                      ['both', '对照'],
                    ].map(([mode, label]) => (
                      <button
                        key={mode}
                        onClick={() => setViewMode(mode)}
                        className={classNames(
                          'px-3 py-0.5 transition-colors',
                          viewMode === mode
                            ? 'bg-ink-800 text-white dark:bg-ink-100 dark:text-ink-900'
                            : 'text-ink-700/60 dark:text-ink-100/60 hover:bg-ink-100 dark:hover:bg-ink-800'
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                {bilingual && (
                  <label className="flex items-center gap-1.5 text-ink-700/60 dark:text-ink-100/60 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={blurTrans}
                      onChange={(e) => setBlurTrans(e.target.checked)}
                    />
                    中文悬停显示
                  </label>
                )}
                {transState?.total != null && (
                  <span className="text-ink-700/50 dark:text-ink-100/50 animate-pulse">
                    翻译中 {transState.done}/{transState.total} 段…
                  </span>
                )}
                {transState?.error && (
                  <span className="text-red-500">
                    翻译失败:{transState.error.slice(0, 60)}{' '}
                    <button onClick={startTranslation} className="underline">
                      重试
                    </button>
                  </span>
                )}
                {magazine?.hasPdf && (
                  <button
                    onClick={() => setPdfOpen((v) => !v)}
                    className={classNames(
                      'ml-auto px-2.5 py-0.5 rounded-full border transition-colors hidden md:inline-block',
                      pdfOpen
                        ? 'bg-ink-800 text-white border-ink-800 dark:bg-ink-100 dark:text-ink-900 dark:border-ink-100'
                        : 'border-ink-200 dark:border-ink-700 text-ink-700/60 dark:text-ink-100/60 hover:border-ink-400'
                    )}
                  >
                    📄 原版 PDF
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto" onMouseUp={handleMouseUp}>
          <article
            className={classNames(
              'mx-auto px-4 py-10',
              bilingual ? 'max-w-5xl' : 'max-w-article'
            )}
          >
            <EditableTitle
              title={article.title}
              onSave={(title) =>
                dispatch({ type: 'updateArticle', id: article.id, patch: { title } })
              }
            />
            <div className="text-sm text-ink-700/50 dark:text-ink-100/50 mb-8 flex items-center gap-3">
              {article.author && <span>{article.author}</span>}
              <span>{magazineName(state, article.magazineId)}</span>
              <span>
                读 {article.readMinutes} 分 · 听 {article.listenMinutes} 分
              </span>
              <button
                onClick={() =>
                  dispatch({
                    type: 'updateArticle',
                    id: article.id,
                    patch: { status: article.status === 'read' ? 'reading' : 'read' },
                  })
                }
                className="ml-auto text-xs px-2 py-1 rounded border border-ink-200 dark:border-ink-700 hover:bg-ink-100 dark:hover:bg-ink-800"
              >
                {article.status === 'read' ? '✓ 已读完' : '标记读完'}
              </button>
              <button
                onClick={() => setNotesOpen((v) => !v)}
                className="text-xs px-2 py-1 rounded border border-ink-200 dark:border-ink-700 hover:bg-ink-100 dark:hover:bg-ink-800"
                title="快捷键 N"
              >
                📝 速记
              </button>
            </div>


            {zhPending && (
              /* 中文模式但译文尚未生成完:逐段显示已完成的译文 */
              <div className="space-y-5">
                {article.paragraphs.map((p, pi) => (
                  <p key={pi} className="leading-[1.9] text-[17px]">
                    {(article.translation || [])[pi] || (
                      <span className="text-ink-700/30 dark:text-ink-100/30 italic">
                        {transState?.error ? '(待翻译)' : '翻译中…'}
                      </span>
                    )}
                  </p>
                ))}
              </div>
            )}
            <div ref={containerRef} className={classNames('space-y-5', zhPending && 'hidden')}>
              {model.paras.map((para) => (
                <div key={para.pi} className="relative">
                  <div
                    className={classNames(
                      bilingual && 'grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 items-start'
                    )}
                  >
                    {/* 对照模式:中文为主(左),英文原文为辅(右) */}
                    {bilingual && (
                      <p
                        className={classNames(
                          'leading-[1.9] text-[17px]',
                          blurTrans && 'blur-[5px] hover:blur-none transition-all duration-200'
                        )}
                      >
                        {translation[para.pi] || (
                          <span className="text-ink-700/30 dark:text-ink-100/30 italic">
                            {transState === 'error' ? '(待翻译)' : '翻译中…'}
                          </span>
                        )}
                      </p>
                    )}
                    <p
                      className={classNames(
                        'leading-[1.9]',
                        isForeign ? 'font-serif' : '',
                        bilingual
                          ? 'text-[15.5px] text-ink-700/75 dark:text-ink-100/75 md:border-l md:border-ink-100 md:dark:border-ink-800 md:pl-6'
                          : 'text-[17px]'
                      )}
                    >
                      {para.sentences.map((s, si) => (
                        <React.Fragment key={s.id}>
                          {si > 0 && displayForeign && ' '}
                          <Sentence
                            sentence={s}
                            segs={segsBySentence.get(s.id) || []}
                            active={s.id === activeSentenceId}
                            isForeign={displayForeign}
                            onClick={(e) => handleSentenceClick(e, s)}
                          />
                        </React.Fragment>
                      ))}
                    </p>
                  </div>
                  {/* Notion 风格批注气泡:大屏显示在段落右侧;速记侧栏/对照模式下改为段落下方内联 */}
                  {notesByPara.has(para.pi) && !notesOpen && !bilingual && (
                    <div className="hidden xl:flex flex-col gap-2 absolute top-0 left-full ml-6 w-52">
                      {notesByPara.get(para.pi).map((h) => (
                        <NoteBubble
                          key={h.id}
                          highlight={h}
                          onClick={(e) => setHlEditor({ hlId: h.id, x: e.clientX, y: e.clientY })}
                        />
                      ))}
                    </div>
                  )}
                  {notesByPara.has(para.pi) && (
                    <div
                      className={classNames(
                        'mt-1.5 space-y-1.5',
                        !notesOpen && !bilingual && 'xl:hidden'
                      )}
                    >
                      {notesByPara.get(para.pi).map((h) => (
                        <NoteBubble
                          key={h.id}
                          highlight={h}
                          onClick={(e) => setHlEditor({ hlId: h.id, x: e.clientX, y: e.clientY })}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <EndOfArticleNav
              article={article}
              state={state}
              dispatch={dispatch}
            />
          </article>
        </div>
      </div>

      <div className="hidden md:contents">
        <NotesSidebar
          open={notesOpen}
          text={noteText}
          onChange={(text) => dispatch({ type: 'setArticleNote', articleId: article.id, text })}
          onClose={() => setNotesOpen(false)}
        />
      </div>

      {/* 划线工具条 */}
      {selToolbar && (
        <div
          className="fixed z-40 -translate-x-1/2 -translate-y-full flex items-center gap-1.5 bg-white dark:bg-ink-800 border border-ink-200 dark:border-ink-700 rounded-lg shadow-lg px-2 py-1.5"
          style={{ left: selToolbar.x, top: selToolbar.y - 8 }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {HL_COLORS.map((c) => (
            <button
              key={c.key}
              title={`高亮(${c.key})`}
              onClick={() => applyHighlight(c.key, false)}
              className={classNames('w-5 h-5 rounded-full border border-black/10', c.dot)}
            />
          ))}
          <div className="w-px h-4 bg-ink-200 dark:bg-ink-700 mx-0.5" />
          <button
            onClick={() => applyHighlight('yellow', true)}
            className="text-xs px-1.5 py-0.5 hover:bg-ink-100 dark:hover:bg-ink-700 rounded"
          >
            💬 批注
          </button>
        </div>
      )}

      {/* 高亮编辑弹层 */}
      {editingHl && (
        <HighlightEditor
          highlight={editingHl}
          pos={hlEditor}
          onChange={(patch) => dispatch({ type: 'updateHighlight', id: editingHl.id, patch })}
          onDelete={() => {
            dispatch({ type: 'deleteHighlight', id: editingHl.id })
            setHlEditor(null)
          }}
          onClose={() => setHlEditor(null)}
        />
      )}

      {/* 生词弹卡 */}
      {wordQuery && (
        <WordPopover
          query={wordQuery}
          onClose={() => setWordQuery(null)}
          onAddVocab={addVocabFromPopover}
          alreadyAdded={state.vocab.some(
            (v) =>
              v.word.toLowerCase() === wordQuery.word.toLowerCase() &&
              v.sentenceId === wordQuery.sentenceId &&
              v.articleId === article.id
          )}
        />
      )}
    </div>
  )
}

// ---- 句子渲染:高亮分片 + 外语单词分词 ----

const WORD_RE = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]*)/

function Sentence({ sentence, segs, active, isForeign, onClick }) {
  const pieces = useMemo(() => {
    const text = sentence.text
    const points = new Set([0, text.length])
    for (const g of segs) {
      points.add(Math.max(0, Math.min(g.start, text.length)))
      points.add(Math.max(0, Math.min(g.end, text.length)))
    }
    const sorted = [...points].sort((a, b) => a - b)
    const out = []
    for (let i = 0; i < sorted.length - 1; i++) {
      const [a, b] = [sorted[i], sorted[i + 1]]
      if (a >= b) continue
      const cover = segs.filter((g) => g.start <= a && g.end >= b)
      out.push({ text: text.slice(a, b), hl: cover[cover.length - 1] || null })
    }
    return out
  }, [sentence.text, JSON.stringify(segs)])

  return (
    <span
      data-sid={sentence.id}
      onClick={onClick}
      className={classNames('cursor-pointer', active && 'sentence-active')}
    >
      {pieces.map((piece, i) => {
        const inner = isForeign
          ? piece.text.split(WORD_RE).map((tok, ti) =>
              WORD_RE.test(tok) && /[A-Za-zÀ-ÿ]/.test(tok[0]) ? (
                <span key={ti} data-word={tok} className="word-token">
                  {tok}
                </span>
              ) : (
                tok
              )
            )
          : piece.text
        return piece.hl ? (
          <span
            key={i}
            data-hl={piece.hl.hlId}
            className={classNames(
              `hl-${piece.hl.color}`,
              'cursor-pointer'
            )}
          >
            {inner}
          </span>
        ) : (
          <React.Fragment key={i}>{inner}</React.Fragment>
        )
      })}
    </span>
  )
}

// 文末导航:标记读完 + 返回本期 / 上一篇 / 下一篇
function EndOfArticleNav({ article, state, dispatch }) {
  // 上一篇/下一篇在同一本周刊内导航
  const list = articlesOfWeek(state, article.weekKey).filter(
    (a) => a.magazineId === article.magazineId
  )
  const idx = list.findIndex((a) => a.id === article.id)
  const prev = idx > 0 ? list[idx - 1] : null
  const next = idx >= 0 && idx + 1 < list.length ? list[idx + 1] : null
  const unreadLeft = list.filter((a) => a.id !== article.id && a.status !== 'read').length

  const goto = (id) =>
    dispatch({ type: 'navigate', route: { page: 'reader', articleId: id } })
  const markRead = () =>
    dispatch({ type: 'updateArticle', id: article.id, patch: { status: 'read' } })

  return (
    <div className="mt-12 pt-6 border-t border-ink-100 dark:border-ink-800">
      <div className="text-center mb-6">
        {article.status !== 'read' ? (
          <button
            onClick={markRead}
            className="px-5 py-2 rounded-md text-sm bg-ink-800 text-white dark:bg-ink-100 dark:text-ink-900 hover:opacity-90"
          >
            ✓ 我读完了
          </button>
        ) : (
          <span className="text-sm text-green-600 dark:text-green-400">
            已读完 🎉{unreadLeft > 0 ? ` 本刊还剩 ${unreadLeft} 篇` : ' 本刊全部读完!'}
          </span>
        )}
      </div>
      <div className="flex items-stretch gap-2">
        {prev ? (
          <button
            onClick={() => goto(prev.id)}
            className="flex-1 min-w-0 text-left px-4 py-3 rounded-xl border border-ink-200 dark:border-ink-700 hover:bg-ink-50 dark:hover:bg-ink-800 transition-colors"
          >
            <div className="text-xs text-ink-700/40 dark:text-ink-100/40 mb-0.5">← 上一篇</div>
            <div className="text-sm font-medium truncate">{prev.title}</div>
          </button>
        ) : (
          <div className="flex-1" />
        )}
        <button
          onClick={() =>
            dispatch({
              type: 'navigate',
              route: { page: 'overview', weekKey: article.weekKey, articleId: null },
            })
          }
          className="shrink-0 px-4 py-3 rounded-xl border border-ink-200 dark:border-ink-700 hover:bg-ink-50 dark:hover:bg-ink-800 text-sm text-ink-700/70 dark:text-ink-100/70 transition-colors"
        >
          返回本期
        </button>
        {next ? (
          <button
            onClick={() => {
              markRead()
              goto(next.id)
            }}
            className="flex-1 min-w-0 text-right px-4 py-3 rounded-xl border border-ink-200 dark:border-ink-700 hover:bg-ink-50 dark:hover:bg-ink-800 transition-colors"
            title="标记本篇已读并打开下一篇"
          >
            <div className="text-xs text-ink-700/40 dark:text-ink-100/40 mb-0.5">下一篇 →</div>
            <div className="text-sm font-medium truncate">{next.title}</div>
          </button>
        ) : (
          <div className="flex-1" />
        )}
      </div>
    </div>
  )
}

// 文章标题:悬停出现铅笔,点击可改成自己想要的标题
function EditableTitle({ title, onSave }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(title)
  if (editing) {
    return (
      <input
        autoFocus
        className="w-full text-3xl font-semibold leading-snug mb-2 bg-transparent border-b border-ink-300 dark:border-ink-600 focus:outline-none"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (value.trim()) onSave(value.trim())
          setEditing(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.target.blur()
          if (e.key === 'Escape') {
            setValue(title)
            setEditing(false)
          }
        }}
      />
    )
  }
  return (
    <h1 className="group text-3xl font-semibold leading-snug mb-2">
      {title}
      <button
        title="编辑标题"
        onClick={() => {
          setValue(title)
          setEditing(true)
        }}
        className="ml-2 text-base align-middle opacity-0 group-hover:opacity-50 hover:!opacity-100"
      >
        ✏️
      </button>
    </h1>
  )
}

function NoteBubble({ highlight, onClick }) {
  return (
    <button
      onClick={onClick}
      className="text-left text-xs bg-white dark:bg-ink-800 border border-ink-200 dark:border-ink-700 rounded-lg shadow-sm px-3 py-2 hover:shadow transition-shadow"
    >
      <div className="text-ink-700/40 dark:text-ink-100/40 mb-0.5 truncate">
        “{highlight.text.slice(0, 24)}{highlight.text.length > 24 ? '…' : ''}”
      </div>
      <div className="text-ink-700/80 dark:text-ink-100/80 line-clamp-3">💬 {highlight.note}</div>
    </button>
  )
}

function HighlightEditor({ highlight, pos, onChange, onDelete, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const style = {
    left: Math.min(pos.x, window.innerWidth - 300),
    top: Math.min(pos.y + 8, window.innerHeight - 220),
  }

  return (
    <div
      ref={ref}
      style={style}
      className="fixed z-40 w-72 bg-white dark:bg-ink-800 rounded-xl shadow-2xl border border-ink-200 dark:border-ink-700 p-3 space-y-2"
    >
      <div className="text-xs text-ink-700/40 dark:text-ink-100/40 truncate">
        “{highlight.text.slice(0, 40)}{highlight.text.length > 40 ? '…' : ''}”
      </div>
      <div className="flex items-center gap-1.5">
        {HL_COLORS.map((c) => (
          <button
            key={c.key}
            onClick={() => onChange({ color: c.key })}
            className={classNames(
              'w-5 h-5 rounded-full border',
              c.dot,
              highlight.color === c.key ? 'border-ink-800 dark:border-ink-100' : 'border-black/10'
            )}
          />
        ))}
        <button
          onClick={onDelete}
          className="ml-auto text-xs text-red-500 hover:underline"
        >
          删除高亮
        </button>
      </div>
      <textarea
        rows={3}
        autoFocus
        className="w-full rounded-md border border-ink-200 dark:border-ink-700 bg-transparent px-2 py-1.5 text-sm"
        placeholder="写一条批注…"
        value={highlight.note}
        onChange={(e) => onChange({ note: e.target.value })}
      />
      <div className="text-right">
        <button
          onClick={onClose}
          className="text-xs px-3 py-1 rounded bg-ink-800 text-white dark:bg-ink-100 dark:text-ink-900"
        >
          完成
        </button>
      </div>
    </div>
  )
}
