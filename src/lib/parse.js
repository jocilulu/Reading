// 上传内容解析:PDF / EPUB / 纯文本 / 网页链接 → 纯文本 → 文章拆分

import { detectLanguage, splitSentences, countWords, estimateMinutes, uid } from './utils'
import { splitArticlesLLM, llmConfigured } from './llm'

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
  return text
    .split(/\n\s*\n|\n(?=\S)/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter((p) => p.length > 0)
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

// 启发式拆分:短、无句末标点的段落视作标题
export function heuristicSplit(text) {
  const paras = toParagraphs(text)
  const articles = []
  let current = null
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i]
    const next = paras[i + 1]
    const isHeading = looksLikeHeading(p) && next && !looksLikeHeading(next)
    // 已有正文段落时,新标题开新文章;紧跟在标题后的短行(作者/副题)并入当前篇
    if (isHeading && (!current || current.paragraphs.length >= 1)) {
      if (current) articles.push(current)
      current = { title: p, author: '', paragraphs: [] }
    } else {
      if (!current) current = { title: '', author: '', paragraphs: [] }
      current.paragraphs.push(p)
    }
  }
  if (current && current.paragraphs.length) articles.push(current)
  if (!articles.length) articles.push({ title: '', author: '', paragraphs: paras })
  return articles.map((a) => ({ ...a, paragraphs: normalizeParagraphs(a.paragraphs) }))
}

// LLM 辅助拆分:识别标题/作者,并用 firstWords 在原文中定位边界
export async function smartSplit(text) {
  if (!llmConfigured()) return heuristicSplit(text)
  try {
    const { articles: toc } = await splitArticlesLLM(text)
    if (!toc?.length) return heuristicSplit(text)
    const paras = toParagraphs(text)
    const boundaries = [] // [{title, author, paraIndex}]
    let searchFrom = 0
    for (const item of toc) {
      const needle = (item.firstWords || '').trim().slice(0, 12)
      if (!needle) continue
      const idx = paras.findIndex(
        (p, i) => i >= searchFrom && p.includes(needle)
      )
      if (idx >= 0) {
        boundaries.push({ title: item.title, author: item.author, paraIndex: idx })
        searchFrom = idx + 1
      }
    }
    if (boundaries.length < 2) return heuristicSplit(text)
    const articles = []
    for (let b = 0; b < boundaries.length; b++) {
      const start = boundaries[b].paraIndex
      const end = b + 1 < boundaries.length ? boundaries[b + 1].paraIndex : paras.length
      const body = paras
        .slice(start, end)
        // 去掉与标题重复的段落
        .filter((p) => p !== boundaries[b].title)
      articles.push({
        title: boundaries[b].title,
        author: boundaries[b].author || '',
        paragraphs: normalizeParagraphs(body),
      })
    }
    return articles
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
