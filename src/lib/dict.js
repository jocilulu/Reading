// 生词查询:词典基本释义(免费词典 API)+ LLM 语境释义
// 查询结果缓存:同一个词在同一句中不重复调用 API。

import { cacheGet, cacheSet } from './storage'
import { explainWordInContext, llmConfigured, LLMNotConfiguredError } from './llm'

// dictionaryapi.dev:免费英语词典
async function fetchDictionary(word) {
  const key = word.toLowerCase()
  const cached = cacheGet('dict', key)
  if (cached !== undefined) return cached
  try {
    const res = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`
    )
    if (!res.ok) {
      cacheSet('dict', key, null)
      return null
    }
    const data = await res.json()
    const entry = Array.isArray(data) ? data[0] : null
    if (!entry) {
      cacheSet('dict', key, null)
      return null
    }
    const meanings = (entry.meanings || []).slice(0, 3).map((m) => ({
      partOfSpeech: m.partOfSpeech,
      definition: m.definitions?.[0]?.definition || '',
      example: m.definitions?.find((d) => d.example)?.example || '',
    }))
    const result = { phonetic: entry.phonetic || '', meanings }
    cacheSet('dict', key, result)
    return result
  } catch {
    return null
  }
}

// 完整查询:返回 { dictionary, llm, llmError }
export async function lookupWord({ word, sentence, sentenceId, articleId, language }) {
  const contextKey = `${word.toLowerCase()}|${articleId}|${sentenceId}`
  const dictPromise = language === 'en' ? fetchDictionary(word) : Promise.resolve(null)

  let llmResult = cacheGet('ctx', contextKey)
  let llmError = null
  if (llmResult === undefined) {
    if (llmConfigured()) {
      try {
        llmResult = await explainWordInContext({ word, sentence, language })
        cacheSet('ctx', contextKey, llmResult)
      } catch (e) {
        llmResult = null
        llmError = e instanceof LLMNotConfiguredError ? 'not-configured' : e.message
      }
    } else {
      llmResult = null
      llmError = 'not-configured'
    }
  }
  const dictionary = await dictPromise
  return { dictionary, llm: llmResult, llmError }
}
