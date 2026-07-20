// 本地持久化:应用状态存 localStorage,音频 Blob 存 IndexedDB

const STATE_KEY = 'wrc-state-v1'

export function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch (e) {
    console.error('加载本地数据失败', e)
    return null
  }
}

let saveTimer = null
export function saveState(state) {
  // 防抖写入,避免频繁序列化
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      const { route, transient, ...persisted } = state
      localStorage.setItem(STATE_KEY, JSON.stringify(persisted))
    } catch (e) {
      console.error('保存本地数据失败', e)
    }
  }, 300)
}

// ---- 通用小缓存(词典/释义查询结果) ----

export function cacheGet(ns, key) {
  try {
    const raw = localStorage.getItem(`wrc-cache-${ns}`)
    if (!raw) return undefined
    return JSON.parse(raw)[key]
  } catch {
    return undefined
  }
}

export function cacheSet(ns, key, value, maxEntries = 500) {
  try {
    const storageKey = `wrc-cache-${ns}`
    const raw = localStorage.getItem(storageKey)
    const obj = raw ? JSON.parse(raw) : {}
    obj[key] = value
    const keys = Object.keys(obj)
    if (keys.length > maxEntries) {
      // 简单淘汰:删掉最早的一批
      for (const k of keys.slice(0, keys.length - maxEntries)) delete obj[k]
    }
    localStorage.setItem(storageKey, JSON.stringify(obj))
  } catch (e) {
    console.warn('缓存写入失败', e)
  }
}

// ---- IndexedDB:TTS 音频缓存 ----

const DB_NAME = 'wrc-audio'
const STORE = 'clips'

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function audioCacheGet(key) {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return undefined
  }
}

export async function audioCachePut(key, blob) {
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(blob, key)
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
  } catch (e) {
    console.warn('音频缓存写入失败', e)
  }
}
