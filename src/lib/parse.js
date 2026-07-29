// 上传内容解析:PDF / EPUB / 纯文本 / 网页链接 → 纯文本 → 文章拆分

import { detectLanguage, splitSentences, countWords, estimateMinutes, uid } from './utils'
import { findArticleBoundaries, llmConfigured } from './llm'

// ---- 各格式提取纯文本 ----

export async function extractTextFromFile(file) {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf')) return extractPdf(file)
  if (name.endsWith('.epub')) return extractEpub(file)
  // 默认按文本处理(txt / md)
  return file.text()
}

async function extractPdf(file) {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const data = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const lines = extractPageLines(content.items, viewport.width)
    pages.push(mergePdfLines(lines))
  }
  return pages.join('\n\n')
}

// 版面分析:杂志多为 2-3 栏排版,必须按"栏"还原阅读顺序,
// 否则同一行高度上左右两栏的文字会被错误拼在一起。
// 步骤:按 y 聚成"行" → 行内按大空隙切成"段(栏内片段)" →
// 聚类片段左边界得到栏 → 跨栏的宽行(大标题等)作为分界带,
// 每个带内按 左栏从上到下 → 右栏从上到下 输出。
export function extractPageLines(items, pageWidth) {
  const frags = items
    .map((it) => {
      const fontSize = Math.hypot(it.transform[2] || 0, it.transform[3] || 0) || 10
      // 个别 PDF 拿不到字形宽度,用字号×字符数估算兜底
      const w = it.width && it.width > 0 ? it.width : it.str.length * fontSize * 0.5
      return { str: it.str, x: it.transform[4], y: it.transform[5], w }
    })
    .filter((f) => f.str.trim().length > 0)
  if (!frags.length) return []

  // 1) 按 y 聚成行(容差 3)
  frags.sort((a, b) => b.y - a.y || a.x - b.x)
  const rows = []
  for (const f of frags) {
    const last = rows[rows.length - 1]
    if (last && Math.abs(last.y - f.y) <= 3) last.frags.push(f)
    else rows.push({ y: f.y, frags: [f] })
  }

  // 2) 行内按水平大空隙(> 15pt,超过正常词距)切成栏内片段
  const segs = []
  for (const row of rows) {
    row.frags.sort((a, b) => a.x - b.x)
    let cur = null
    for (const f of row.frags) {
      if (cur && f.x - cur.x1 <= 15) {
        const gap = f.x - cur.x1
        cur.text += (gap > 1.5 ? ' ' : '') + f.str
        cur.x1 = Math.max(cur.x1, f.x + f.w)
      } else {
        if (cur) segs.push(cur)
        cur = { y: row.y, x0: f.x, x1: f.x + f.w, text: f.str }
      }
    }
    if (cur) segs.push(cur)
  }

  // 3) 聚类片段左边界 → 栏起点(出现 ≥3 次的聚类才算一栏)
  const starts = segs.map((s) => s.x0).sort((a, b) => a - b)
  const clusters = []
  for (const x of starts) {
    const last = clusters[clusters.length - 1]
    if (last && x - last.max <= 30) {
      last.max = x
      last.n++
    } else {
      clusters.push({ min: x, max: x, n: 1 })
    }
  }
  const columns = clusters.filter((c) => c.n >= 3).map((c) => c.min)
  if (columns.length <= 1) {
    // 单栏:按 y 从上到下直接输出
    return segs.sort((a, b) => b.y - a.y || a.x0 - b.x0).map((s) => s.text)
  }

  const colOf = (s) => {
    let best = 0
    for (let c = 0; c < columns.length; c++) {
      if (s.x0 >= columns[c] - 20) best = c
    }
    return best
  }
  // 跨栏判定:文字越过了下一栏的起点(比按页宽比例判断更稳)
  const spanning = (s) => {
    const c = colOf(s)
    if (c < columns.length - 1 && s.x1 > columns[c + 1] + 15) return true
    return s.x1 - s.x0 > pageWidth * 0.55
  }

  // 4) 跨栏宽行切分成带;带内按栏序输出
  segs.sort((a, b) => b.y - a.y || a.x0 - b.x0)
  const out = []
  let band = []
  const flushBand = () => {
    if (!band.length) return
    for (let c = 0; c < columns.length; c++) {
      for (const s of band) {
        if (colOf(s) === c) out.push(s.text)
      }
    }
    band = []
  }
  for (const s of segs) {
    if (spanning(s)) {
      flushBand()
      out.push(s.text)
      out.push('') // 跨栏标题独立成段(空行让后续合并在此断开)
    } else {
      band.push(s)
    }
  }
  flushBand()
  return out
}

// PDF 的"行"只是排版换行,不是段落边界。把行重新拼成完整段落:
// - 行尾连字符断词(inno-\nvation)拼回原词
// - 只有"句末标点 + 行明显偏短(段落最后一行)"才视为段落结束
export function mergePdfLines(rawLines) {
  // 空字符串是上游插入的硬分段标记
  const lines = rawLines.map((l) => l.replace(/\s+/g, ' ').trim())
  if (!lines.some(Boolean)) return ''
  const widths = [...lines.filter(Boolean).map((l) => l.length)].sort((a, b) => a - b)
  const median = widths[Math.floor(widths.length / 2)] || 1
  const paras = []
  let cur = ''
  const flush = () => {
    if (cur.trim()) paras.push(cur.trim())
    cur = ''
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) {
      flush() // 硬分段标记
      continue
    }
    const isCjk = /[一-鿿]/.test(line)
    // 很短且无句末标点的孤行(标题/栏目名)自成一段
    const headingLike =
      line.length < median * 0.5 && !/[.!?,;:。!?,;:]$/.test(line) && line.length < 60
    if (headingLike) {
      flush()
      paras.push(line)
      continue
    }
    if (!cur) {
      cur = line
    } else if (/-$/.test(cur) && /^[a-z]/.test(line)) {
      cur = cur.slice(0, -1) + line // 连字符断词
    } else if (/[一-鿿]$/.test(cur) && isCjk) {
      cur += line // 中文行间不加空格
    } else {
      cur += ' ' + line
    }
    const endsSentence = /[.!?。!?][”"'』」)\)]?$/.test(line)
    const shortLine = line.length < median * 0.75
    if (endsSentence && (shortLine || i === lines.length - 1)) flush()
  }
  flush()
  return paras.join('\n\n')
}

async function extractEpub(file) {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const containerXml = await zip.file('META-INF/container.xml')?.async('string')
  if (!containerXml) throw new Error('EPUB 缺少 container.xml')
  const opfPath = /full-path="([^"]+)"/.exec(containerXml)?.[1]
  if (!opfPath) throw new Error('EPUB 缺少 OPF 描述文件')
  const opf = await zip.file(opfPath).async('string')
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  const doc = new DOMParser().parseFromString(opf, 'application/xml')
  const manifest = {}
  doc.querySelectorAll('manifest > item').forEach((item) => {
    manifest[item.getAttribute('id')] = item.getAttribute('href')
  })
  const parts = []
  for (const ref of doc.querySelectorAll('spine > itemref')) {
    const href = manifest[ref.getAttribute('idref')]
    if (!href) continue
    const entry = zip.file(opfDir + decodeURIComponent(href))
    if (!entry) continue
    const html = await entry.async('string')
    parts.push(htmlToText(html))
  }
  return parts.join('\n\n')
}

export async function extractTextFromUrl(url) {
  // 浏览器直接抓取,受目标站点 CORS 限制;失败时提示用户改用粘贴
  const res = await fetch(url)
  if (!res.ok) throw new Error(`抓取失败:HTTP ${res.status}`)
  const html = await res.text()
  return htmlToText(html)
}

export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style, nav, footer, header, aside, noscript').forEach((el) =>
    el.remove()
  )
  const root =
    doc.querySelector('article') || doc.querySelector('main') || doc.body || doc
  const blocks = []
  const walk = (node) => {
    for (const child of node.children || []) {
      const tag = child.tagName?.toLowerCase()
      if (['p', 'h1', 'h2', 'h3', 'h4', 'li', 'blockquote'].includes(tag)) {
        const text = child.textContent.replace(/\s+/g, ' ').trim()
        if (text) blocks.push(text)
      } else {
        walk(child)
      }
    }
  }
  walk(root)
  if (!blocks.length) {
    const text = root.textContent || ''
    return text.replace(/\n{3,}/g, '\n\n').trim()
  }
  return blocks.join('\n\n')
}

// ---- 文章拆分 ----

function toParagraphs(text) {
  let paras = text
    .split(/\n\s*\n|\n(?=\S)/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter((p) => p.length > 0)
  // 去噪:纯页码、反复出现的短行(页眉/页脚,如刊名+日期)
  const freq = new Map()
  for (const p of paras) {
    if (p.length < 80) freq.set(p, (freq.get(p) || 0) + 1)
  }
  paras = paras.filter((p) => {
    if (/^\d{1,4}$/.test(p)) return false
    if (p.length < 80 && (freq.get(p) || 0) >= 3) return false
    // 纯日期行(Jul 23rd 2026 / July 23, 2026)
    if (/^[A-Z][a-z]{2,8}\.? \d{1,2}(?:st|nd|rd|th)?,? \d{4}$/.test(p)) return false
    // 图片/插画署名行
    if (/^(Illustrations?|Photographs?|Images?|Photos?|Sources?|Chart|Graphic)s?\s*[::]/i.test(p) && p.length < 80) return false
    return true
  })
  return paras
}

// 杂志的两类强结构信号:
// - 文末符:经济学人等用 ■ 标记一篇文章结束
// - 栏目行:如 "Leaders | Aoun goals"(栏目 | 题眼),出现在每篇文章开头
const END_MARK_RE = /[■▪◼●◻□]\s*$/
const RUBRIC_RE = /^[A-Z0-9][\w&,''’ ]{1,32} \| \S/

function countStrongSignals(paras) {
  let n = 0
  for (const p of paras) {
    if (END_MARK_RE.test(p) || RUBRIC_RE.test(p)) n++
  }
  return n
}

// 强信号切分:按 文末符/栏目行 切块,块内组装标题(合并换行标题、吸收署名)
function strongSignalSplit(paras) {
  const blocks = []
  let cur = []
  for (const p of paras) {
    if (RUBRIC_RE.test(p) && cur.length) {
      blocks.push(cur)
      cur = [p]
    } else {
      cur.push(p)
      if (END_MARK_RE.test(p)) {
        blocks.push(cur)
        cur = []
      }
    }
  }
  if (cur.length) blocks.push(cur)

  const articles = []
  blocks.forEach((block, bi) => {
    // 去掉文末符
    block = block.map((p) => p.replace(END_MARK_RE, '').trim()).filter(Boolean)
    if (!block.length) return
    let rubric = ''
    if (RUBRIC_RE.test(block[0])) rubric = block.shift()
    // 开头连续的标题行(最多 3 行拼成完整标题)与署名行
    const titleLines = []
    let author = ''
    while (block.length && titleLines.length < 3) {
      const p = block[0]
      const by = bylineOf(p)
      if (by) {
        if (!author) author = by
        block.shift()
        continue
      }
      if (looksLikeHeading(p)) {
        titleLines.push(p)
        block.shift()
        continue
      }
      break
    }
    let title = titleLines.join(' ')
    if (!title && rubric) title = rubric.split('|')[1]?.trim() || rubric
    if (!title && bi === 0) title = '刊首内容(封面/目录等)'
    const bodyChars = block.join('').length

    // 订阅/推广块:整块丢弃
    const PROMO_RE =
      /^(stay on top|subscribe|sign up|listen to|download the|read more of|for more coverage|get a daily)/i
    if (PROMO_RE.test(titleLines[0] || block[0] || '') && block.length <= 4) return

    // 无标题的小块(作者简介、编者按等):并入上一篇
    if (!rubric && !titleLines.length && bi > 0 && block.length <= 4 && articles.length) {
      articles[articles.length - 1].paragraphs.push(...normalizeParagraphs(block))
      return
    }

    // 分区页/目录碎片:正文过少,丢弃
    if (!block.length) return
    if (!rubric && block.length <= 2 && bodyChars < 450) return

    articles.push({
      title: title || block[0].slice(0, 40),
      author,
      paragraphs: normalizeParagraphs(block),
    })
  })
  return articles
}

// "By 作者名" 署名行
function bylineOf(p) {
  const m = /^by\s+([A-Z][\w.'’-]+(?:\s+(?:and\s+)?[A-Z][\w.'’-]+){0,5})\s*$/i.exec(p.trim())
  return m && p.length < 60 ? m[1] : null
}

// 过长的段落按句子边界重切成适合阅读的段落(也让对照翻译的粒度更合理)
function normalizeParagraphs(paras) {
  const MAX = 700
  const out = []
  for (const p of paras) {
    if (p.length <= MAX) {
      out.push(p)
      continue
    }
    const lang = detectLanguage(p)
    const sentences = splitSentences(p, lang)
    let cur = ''
    for (const s of sentences) {
      const joined = cur ? (lang === 'zh' ? cur + s : cur + ' ' + s) : s
      if (joined.length > MAX && cur) {
        out.push(cur)
        cur = s
      } else {
        cur = joined
      }
    }
    if (cur) out.push(cur)
  }
  return out
}

function looksLikeHeading(p) {
  if (p.length > 80) return false
  if (/[。.!?!?,,;;:]$/.test(p)) return false
  // 语言按段落自身判断,混排文档里中文标题才不会被漏掉
  const lang = detectLanguage(p)
  const words = countWords(p, lang)
  if (lang === 'zh') return p.length <= 30 && words >= 2
  return words >= 1 && words <= 14
}

// 启发式拆分:短、无句末标点的段落视作标题;"By 作者" 行是强信号
export function heuristicSplit(text) {
  const paras = toParagraphs(text)
  // 文末符/栏目行足够多时,用确定性的强信号切分(经济学人等刊物)
  if (countStrongSignals(paras) >= 4) {
    const strong = strongSignalSplit(paras)
    if (strong.length >= 2) return strong
  }
  const articles = []
  let current = null
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i]
    const next = paras[i + 1]
    const nextIsByline = next && bylineOf(next)
    const isHeading =
      looksLikeHeading(p) && next && (nextIsByline || !looksLikeHeading(next))
    // 已有正文段落时,新标题开新文章;紧跟在标题后的短行(作者/副题)并入当前篇
    if (isHeading && (!current || current.paragraphs.length >= 1 || nextIsByline)) {
      if (current && (current.paragraphs.length || current.title)) articles.push(current)
      current = { title: p, author: '', paragraphs: [] }
      if (nextIsByline) {
        current.author = bylineOf(next)
        i++ // 署名行不进正文
      }
    } else {
      if (!current) current = { title: '', author: '', paragraphs: [] }
      const by = bylineOf(p)
      if (by && !current.author && current.paragraphs.length === 0) {
        current.author = by // 标题识别失败时,散落的署名行也能补上作者
      } else {
        current.paragraphs.push(p)
      }
    }
  }
  if (current && current.paragraphs.length) articles.push(current)
  if (!articles.length) articles.push({ title: '', author: '', paragraphs: paras })
  return articles.map((a) => ({ ...a, paragraphs: normalizeParagraphs(a.paragraphs) }))
}

// LLM 辅助拆分 v2:全文按段落编号、分块送给模型,直接返回边界段落号。
// 相比匹配"开头文字"更稳,且不再受采样长度限制,整本长刊都能覆盖。
export async function smartSplit(text) {
  if (!llmConfigured()) return heuristicSplit(text)
  try {
    const paras = toParagraphs(text)
    if (paras.length < 4) return heuristicSplit(text)
    // 强结构信号充足时直接确定性切分:比 LLM 更快、更准、零成本
    if (countStrongSignals(paras) >= 8) {
      const strong = strongSignalSplit(paras)
      if (strong.length >= 3) return strong
    }

    // 按 ~28k 字符分块,段落编号全局连续
    const CHUNK_CHARS = 28000
    const chunks = []
    let cur = []
    let size = 0
    let start = 0
    paras.forEach((p, i) => {
      if (size > CHUNK_CHARS && cur.length) {
        chunks.push({ start, paras: cur })
        cur = []
        size = 0
        start = i
      }
      cur.push(p)
      size += p.length
    })
    if (cur.length) chunks.push({ start, paras: cur })

    const marks = []
    for (let c = 0; c < chunks.length; c++) {
      const chunk = chunks[c]
      // 每段截前 300 字符足以判断边界,控制 token 消耗
      const numbered = chunk.paras
        .map((p, k) => `[${chunk.start + k}] ${p.length > 300 ? p.slice(0, 300) + '…' : p}`)
        .join('\n\n')
      const res = await findArticleBoundaries(numbered, {
        part: c + 1,
        totalParts: chunks.length,
      })
      for (const a of res.articles || []) {
        if (
          Number.isInteger(a.startIndex) &&
          a.startIndex >= chunk.start &&
          a.startIndex < chunk.start + chunk.paras.length
        ) {
          marks.push(a)
        }
      }
    }
    marks.sort((a, b) => a.startIndex - b.startIndex)
    const uniq = []
    for (const m of marks) {
      if (!uniq.length || m.startIndex > uniq[uniq.length - 1].startIndex) uniq.push(m)
    }
    if (!uniq.length) return heuristicSplit(text)

    // 第一篇文章之前的内容(封面/目录等)单独成篇,交给用户在确认页决定去留
    if (uniq[0].startIndex > 0) {
      uniq.unshift({ title: '刊首内容(目录/导言等)', author: '', startIndex: 0 })
    }

    const articles = []
    for (let b = 0; b < uniq.length; b++) {
      const startIdx = uniq[b].startIndex
      const endIdx = b + 1 < uniq.length ? uniq[b + 1].startIndex : paras.length
      let body = paras.slice(startIdx, endIdx)
      // 去掉与标题重复的段落;开头的署名行转为作者
      let author = uniq[b].author || ''
      body = body.filter((p, k) => {
        if (k < 2 && uniq[b].title && p.trim() === uniq[b].title.trim()) return false
        if (k < 3) {
          const by = bylineOf(p)
          if (by) {
            if (!author) author = by
            return false
          }
        }
        return true
      })
      if (!body.length) continue
      articles.push({
        title: uniq[b].title,
        author,
        paragraphs: normalizeParagraphs(body),
      })
    }
    return articles.length ? articles : heuristicSplit(text)
  } catch (e) {
    console.warn('LLM 拆分失败,使用启发式拆分', e)
    return heuristicSplit(text)
  }
}

// 把草稿文章补全成完整的 article 记录
export function finalizeArticle(draft, { magazineId, weekKey, order }) {
  const content = draft.paragraphs.join('\n\n')
  const lang = detectLanguage(content)
  const words = countWords(content, lang)
  const sentenceCount = draft.paragraphs
    .map((p) => splitSentences(p, lang).length)
    .reduce((a, b) => a + b, 0)
  return {
    id: uid('a'),
    magazineId,
    weekKey,
    order,
    title: draft.title || draft.paragraphs[0]?.slice(0, 30) || '未命名文章',
    author: draft.author || '',
    paragraphs: draft.paragraphs,
    language: lang,
    words,
    sentenceCount,
    readMinutes: estimateMinutes(words, lang, 'read'),
    listenMinutes: estimateMinutes(words, lang, 'listen'),
    summary: '',
    tags: [],
    status: 'unread', // unread | reading | read
    listenedDone: false,
    starred: false,
    createdAt: Date.now(),
  }
}
