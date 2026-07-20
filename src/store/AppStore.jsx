// 全局状态:周刊 / 文章 / 笔记 / 生词 / 收听记录 / 设置 / 路由
// 通过 React Context + useReducer 管理,持久化到 localStorage。

import React, { createContext, useContext, useEffect, useReducer } from 'react'
import { loadState, saveState } from '../lib/storage'
import { configureLLM } from '../lib/llm'
import { configureTTS } from '../lib/tts'
import { uid, weekKeyOf, dayKeyOf } from '../lib/utils'

const initialState = {
  magazines: [], // { id, weekKey, name, sourceType, createdAt }
  articles: [], // 见 parse.finalizeArticle
  highlights: [], // { id, articleId, color, note, text, segs:[{sentenceId,start,end}], createdAt }
  articleNotes: {}, // articleId -> { text, updatedAt }
  vocab: [], // { id, word, articleId, magazineId, weekKey, sentence, sentenceId, baseMeaning, contextMeaning, example, phonetic, mastered, createdAt }
  listening: {}, // dayKey -> seconds
  settings: {
    llm: { apiKey: '', model: 'claude-opus-4-8' },
    tts: { provider: 'browser', baseUrl: '', apiKey: '', voice: '' },
    dark: false,
  },
  route: { page: 'overview', weekKey: null, articleId: null, targetSentence: null },
}

function reducer(state, action) {
  switch (action.type) {
    case 'navigate':
      return { ...state, route: { ...state.route, targetSentence: null, ...action.route } }

    case 'addMagazine': {
      const { magazine, articles } = action
      return {
        ...state,
        magazines: [...state.magazines, magazine],
        articles: [...state.articles, ...articles],
      }
    }

    case 'deleteMagazine': {
      const removedIds = new Set(
        state.articles.filter((a) => a.magazineId === action.id).map((a) => a.id)
      )
      return {
        ...state,
        magazines: state.magazines.filter((m) => m.id !== action.id),
        articles: state.articles.filter((a) => !removedIds.has(a.id)),
        highlights: state.highlights.filter((h) => !removedIds.has(h.articleId)),
        vocab: state.vocab.filter((v) => !removedIds.has(v.articleId)),
      }
    }

    case 'updateArticle':
      return {
        ...state,
        articles: state.articles.map((a) =>
          a.id === action.id ? { ...a, ...action.patch } : a
        ),
      }

    case 'reorderArticles': {
      // action.orderedIds:同一周内卡片新的顺序
      const orderMap = new Map(action.orderedIds.map((id, i) => [id, i]))
      return {
        ...state,
        articles: state.articles.map((a) =>
          orderMap.has(a.id) ? { ...a, order: orderMap.get(a.id) } : a
        ),
      }
    }

    case 'addHighlight':
      return { ...state, highlights: [...state.highlights, action.highlight] }

    case 'updateHighlight':
      return {
        ...state,
        highlights: state.highlights.map((h) =>
          h.id === action.id ? { ...h, ...action.patch } : h
        ),
      }

    case 'deleteHighlight':
      return {
        ...state,
        highlights: state.highlights.filter((h) => h.id !== action.id),
      }

    case 'setArticleNote': {
      const next = { ...state.articleNotes }
      if (action.text.trim()) {
        next[action.articleId] = { text: action.text, updatedAt: Date.now() }
      } else {
        delete next[action.articleId]
      }
      return { ...state, articleNotes: next }
    }

    case 'addVocab': {
      // 同一文章同一句里的同一个词不重复收藏
      const dup = state.vocab.some(
        (v) =>
          v.word.toLowerCase() === action.entry.word.toLowerCase() &&
          v.sentenceId === action.entry.sentenceId &&
          v.articleId === action.entry.articleId
      )
      if (dup) return state
      return { ...state, vocab: [...state.vocab, action.entry] }
    }

    case 'updateVocab':
      return {
        ...state,
        vocab: state.vocab.map((v) => (v.id === action.id ? { ...v, ...action.patch } : v)),
      }

    case 'deleteVocab':
      return { ...state, vocab: state.vocab.filter((v) => v.id !== action.id) }

    case 'addListening': {
      const day = action.dayKey || dayKeyOf()
      const listening = { ...state.listening }
      listening[day] = (listening[day] || 0) + action.seconds
      return { ...state, listening }
    }

    case 'updateSettings':
      return { ...state, settings: { ...state.settings, ...action.patch } }

    default:
      return state
  }
}

const StoreContext = createContext(null)

export function AppStoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState, (init) => {
    const saved = loadState()
    if (!saved) return init
    return {
      ...init,
      ...saved,
      settings: {
        ...init.settings,
        ...saved.settings,
        llm: { ...init.settings.llm, ...saved.settings?.llm },
        tts: { ...init.settings.tts, ...saved.settings?.tts },
      },
      route: init.route,
    }
  })

  useEffect(() => {
    saveState(state)
  }, [state])

  useEffect(() => {
    configureLLM(state.settings.llm)
    configureTTS(state.settings.tts)
  }, [state.settings])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', state.settings.dark)
  }, [state.settings.dark])

  return (
    <StoreContext.Provider value={{ state, dispatch }}>{children}</StoreContext.Provider>
  )
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore 必须在 AppStoreProvider 内使用')
  return ctx
}

// ---- 常用派生数据 ----

export function useCurrentWeekKey() {
  const { state } = useStore()
  return state.route.weekKey || weekKeyOf()
}

export function articlesOfWeek(state, weekKey) {
  return state.articles
    .filter((a) => a.weekKey === weekKey)
    .sort((a, b) => {
      if (a.starred !== b.starred) return a.starred ? -1 : 1
      return (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt
    })
}

export function magazineName(state, magazineId) {
  return state.magazines.find((m) => m.id === magazineId)?.name || '未命名周刊'
}

export function makeVocabEntry(data) {
  return { id: uid('v'), mastered: false, createdAt: Date.now(), ...data }
}
