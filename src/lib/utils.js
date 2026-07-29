// 通用工具:ID、周计算(周一为起点)、语言检测、分句、阅读时长估算等

export function uid(prefix = '') {
  return (
    prefix +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8)
  )
}

// ---- 周(ISO week,周一起点) ----

export function startOfWeek(date) {
  const d = new Date(date)
  const day = (d.getDay() + 6) % 7 // 周一=0
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - day)
  return d
}

export function isoWeekInfo(date) {
  // 返回 { year, week },ISO 8601 规则(周一起点,第一个包含周四的周为第 1 周)
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dayNum + 3) // 本周周四
  const year = d.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(year, 0, 4))
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3)
  const week = 1 + Math.round((d - firstThursday) / (7 * 24 * 3600 * 1000))
  return { year, week }
}

export function weekKeyOf(date = new Date()) {
  const { year, week } = isoWeekInfo(date)
  return `${year}-W${String(week).padStart(2, '0')}`
}

export function parseWeekKey(key) {
  const m = /^(\d{4})-W(\d{2})$/.exec(key)
  if (!m) return null
  return { year: Number(m[1]), week: Number(m[2]) }
}

export function weekLabel(key) {
  const p = parseWeekKey(key)
  if (!p) return key
  return `${p.year} 年第 ${p.week} 期`
}

export function shiftWeekKey(key, delta) {
  const p = parseWeekKey(key)
  if (!p) return key
  // 用第 week 周的周四定位,再平移
  const jan4 = new Date(p.year, 0, 4)
  const monday = startOfWeek(jan4)
  monday.setDate(monday.getDate() + (p.week - 1 + delta) * 7)
  return weekKeyOf(monday)
}

export function dayKeyOf(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function weekKeyOfDayKey(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number)
  return weekKeyOf(new Date(y, m - 1, d))
}

export function daysOfWeek(weekKey) {
  // 返回该周周一到周日的 dayKey 列表
  const p = parseWeekKey(weekKey)
  if (!p) return []
  const jan4 = new Date(p.year, 0, 4)
  const monday = startOfWeek(jan4)
  monday.setDate(monday.getDate() + (p.week - 1) * 7)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(d.getDate() + i)
    return dayKeyOf(d)
  })
}

// ---- 语言检测 ----

export function detectLanguage(text) {
  const sample = text.slice(0, 4000)
  let cjk = 0
  let latin = 0
  for (const ch of sample) {
    const code = ch.codePointAt(0)
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf)
    ) {
      cjk++
    } else if (/[a-zA-Z]/.test(ch)) {
      latin++
    }
  }
  if (cjk > latin * 0.4) return 'zh'
  if (latin > 0) return 'en'
  return 'other'
}

export function languageLabel(lang) {
  return { zh: '中文', en: '英文', other: '其他' }[lang] || lang
}

// ---- 分句 ----

export function splitSentences(text, lang) {
  const result = []
  if (!text) return result
  if (lang === 'zh') {
    // 按中文标点分句,保留标点
    const re = /[^。!?;…\n]+[。!?;…]*[”』」）)]*/g
    let m
    while ((m = re.exec(text)) !== null) {
      const s = m[0].trim()
      if (s) result.push(s)
    }
  } else {
    // 英文/其他:先按 .!? 粗切,再做合并回填,避免缩写/小数/人名缩写被误切
    const re = /[^.!?\n]+(?:[.!?]+["'”’)\]]*|$)/g
    const pieces = text.match(re) || []
    const abbrev =
      /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|Fig|No|Nos|Vol|pp|approx|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|U\.S|U\.K|U\.N)\.["'”’)\]]*$/
    for (const raw of pieces) {
      const piece = raw
      const prev = result[result.length - 1]
      const shouldMerge =
        prev &&
        // 上一句以缩写结尾
        (abbrev.test(prev) ||
          // 单个大写字母缩写(J. Smith),且后面还是正文
          /\b[A-Z]\.$/.test(prev) ||
          // 小数点被切开(3. + 5 million)
          (/\d\.$/.test(prev) && /^\s*\d/.test(piece)) ||
          // 新片段以小写开头,大概率是误切
          /^\s*[a-z]/.test(piece))
      if (shouldMerge) {
        result[result.length - 1] = prev + piece
      } else {
        const s = piece.trim()
        if (s) result.push(s)
      }
    }
    for (let i = 0; i < result.length; i++) result[i] = result[i].trim()
  }
  return result.length ? result.filter(Boolean) : [text.trim()].filter(Boolean)
}

// ---- 字数与时长估算 ----

export function countWords(text, lang) {
  if (lang === 'zh') {
    return (text.match(/[一-鿿㐀-䶿]/g) || []).length
  }
  return (text.match(/[A-Za-z0-9'’-]+/g) || []).length
}

export function estimateMinutes(words, lang, mode) {
  // mode: 'read' | 'listen'
  const rates = {
    zh: { read: 400, listen: 220 },
    en: { read: 220, listen: 150 },
    other: { read: 220, listen: 150 },
  }
  const rate = (rates[lang] || rates.other)[mode]
  return Math.max(1, Math.round(words / rate))
}

export function estimateSentenceSeconds(text, lang, rate = 1) {
  // 用于播放器进度估算
  const words = countWords(text, lang)
  const perMin = lang === 'zh' ? 220 : 150
  return Math.max(0.8, (words / perMin) * 60) / rate
}

export function formatSeconds(sec) {
  sec = Math.max(0, Math.round(sec))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatHoursMinutes(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  if (h > 0) return `${h} 小时 ${m} 分钟`
  return `${m} 分钟`
}

export function classNames(...args) {
  return args.filter(Boolean).join(' ')
}

export async function sha1(text) {
  const data = new TextEncoder().encode(text)
  const buf = await crypto.subtle.digest('SHA-1', data)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
