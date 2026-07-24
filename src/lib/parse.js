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
    const content = await page.getTextContent()
    // 按 y 坐标分行
    let lastY = null
    let line = []
    const lines = []
    for (const item of content.items) {
      const y = Math.round(item.transform[5])
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        lines.push(line.join(''))
        line = []
      }
      line.push(item.str)
      lastY = y
    }
    if (line.length) lines.push(line.join(''))
    pages.push(mergePdfLines(lines))
  }
  return pages.join('\n\n')
}

// PDF 的"行"只是排版换行,不是段落边界。把行重新拼成完整段落:
// - 行尾连字符断词(inno-\nvation)拼回原词
// - 只有"句末标点 + 行明显偏短(段落最后一行)"才视为段落结束
function mergePdfLines(rawLines) {
  const lines = rawLines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (!lines.length) return ''
  const widths = [...lines.map((l) => l.length)].sort((a, b) => a - b)
  const median = widths[Math.floor(widths.length / 2)] || 1
  const paras = []
  let cur = ''
  const flush = () => {
    if (cur.trim()) paras.push(cur.trim())
    cur = ''
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
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
    return true
  })
  return paras
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
