// TTS 播放引擎
//
// 以"句子"为播放单元,统一驱动两种后端:
//   1. API TTS(OpenAI 兼容 /audio/speech 接口,按句生成、IndexedDB 缓存)
//   2. 浏览器 SpeechSynthesis(无需配置的回退方案)
//
// SentencePlayer 对外事件:
//   onSentence(index)      当前朗读句变化(用于高亮与滚动跟随)
//   onTick(playedSeconds)  每秒回调实际播放时长(用于收听统计,暂停不计)
//   onState(state)         'idle' | 'loading' | 'playing' | 'paused' | 'ended'

import { estimateSentenceSeconds, sha1 } from './utils'
import { audioCacheGet, audioCachePut } from './storage'

let _ttsSettings = { provider: 'browser', baseUrl: '', apiKey: '', voice: '' }

export function configureTTS(settings) {
  _ttsSettings = { ..._ttsSettings, ...settings }
}

export function ttsProviderName() {
  return _ttsSettings.provider === 'api' && _ttsSettings.baseUrl
    ? 'API 语音'
    : '浏览器语音'
}

// ---- 浏览器语音选择 ----

function pickVoice(lang) {
  const voices = window.speechSynthesis?.getVoices?.() || []
  const wanted = lang === 'zh' ? 'zh' : 'en'
  const candidates = voices.filter((v) => v.lang?.toLowerCase().startsWith(wanted))
  // 优先本地、名字里带 Natural/Premium 的声音
  candidates.sort((a, b) => {
    const score = (v) =>
      (v.localService ? 2 : 0) + (/natural|premium|enhanced/i.test(v.name) ? 1 : 0)
    return score(b) - score(a)
  })
  return candidates[0] || null
}

// ---- API TTS:按句生成并缓存 ----

async function fetchApiClip(text, lang) {
  const { baseUrl, apiKey, voice } = _ttsSettings
  const key = 'clip-' + (await sha1(`${voice}|${lang}|${text}`))
  const cached = await audioCacheGet(key)
  if (cached) return cached
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: text,
      voice: voice || 'alloy',
      response_format: 'mp3',
    }),
  })
  if (!res.ok) throw new Error(`TTS API 错误:${res.status}`)
  const blob = await res.blob()
  await audioCachePut(key, blob)
  return blob
}

export class SentencePlayer {
  constructor({ sentences, lang, onSentence, onTick, onState }) {
    this.sentences = sentences // [{ id, text }]
    this.lang = lang
    this.onSentence = onSentence || (() => {})
    this.onTick = onTick || (() => {})
    this.onState = onState || (() => {})
    this.index = 0
    this.rate = 1
    this.state = 'idle'
    this._audio = null
    this._utterance = null
    this._tickTimer = null
    this._generation = 0 // 防止过期回调推进播放
  }

  get useApi() {
    return _ttsSettings.provider === 'api' && Boolean(_ttsSettings.baseUrl)
  }

  // 估算的每句时长与累计时间轴,用于进度条和 ±15 秒跳转
  durations() {
    return this.sentences.map((s) =>
      estimateSentenceSeconds(s.text, this.lang, this.rate)
    )
  }

  totalSeconds() {
    return this.durations().reduce((a, b) => a + b, 0)
  }

  elapsedSeconds() {
    const d = this.durations()
    return d.slice(0, this.index).reduce((a, b) => a + b, 0)
  }

  _setState(s) {
    this.state = s
    this.onState(s)
  }

  _startTick() {
    this._stopTick()
    let last = Date.now()
    this._tickTimer = setInterval(() => {
      const now = Date.now()
      this.onTick((now - last) / 1000)
      last = now
    }, 1000)
  }

  _stopTick() {
    clearInterval(this._tickTimer)
    this._tickTimer = null
  }

  async play(index = this.index) {
    this.stop(false)
    const gen = ++this._generation
    this.index = Math.max(0, Math.min(index, this.sentences.length - 1))
    this.onSentence(this.index)
    this._setState('loading')
    try {
      if (this.useApi) await this._playApi(gen)
      else this._playBrowser(gen)
    } catch (e) {
      console.error('播放失败,回退浏览器语音', e)
      if (gen === this._generation) this._playBrowser(gen)
    }
  }

  async _playApi(gen) {
    const sentence = this.sentences[this.index]
    const blob = await fetchApiClip(sentence.text, this.lang)
    if (gen !== this._generation) return
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.playbackRate = this.rate
    this._audio = audio
    audio.onended = () => {
      URL.revokeObjectURL(url)
      if (gen !== this._generation) return
      this._advance(gen)
    }
    await audio.play()
    if (gen !== this._generation) {
      audio.pause()
      return
    }
    this._setState('playing')
    this._startTick()
    // 预取下一句
    const next = this.sentences[this.index + 1]
    if (next) fetchApiClip(next.text, this.lang).catch(() => {})
  }

  _playBrowser(gen) {
    const sentence = this.sentences[this.index]
    const u = new SpeechSynthesisUtterance(sentence.text)
    u.rate = this.rate
    u.lang = this.lang === 'zh' ? 'zh-CN' : 'en-US'
    const voice = pickVoice(this.lang)
    if (voice) u.voice = voice
    u.onend = () => {
      if (gen !== this._generation) return
      this._advance(gen)
    }
    u.onerror = (e) => {
      if (gen !== this._generation) return
      // interrupted/canceled 属于主动停止,不往下走
      if (e.error === 'interrupted' || e.error === 'canceled') return
      this._advance(gen)
    }
    this._utterance = u
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
    this._setState('playing')
    this._startTick()
  }

  _advance(gen) {
    this._stopTick()
    if (this.index + 1 < this.sentences.length) {
      this.index += 1
      this.onSentence(this.index)
      if (this.useApi) {
        this._playApi(gen).catch((e) => {
          console.error(e)
          this._playBrowser(gen)
        })
      } else {
        this._playBrowser(gen)
      }
    } else {
      this._setState('ended')
    }
  }

  pause() {
    if (this.state !== 'playing') return
    this._stopTick()
    if (this._audio) this._audio.pause()
    else window.speechSynthesis.pause()
    this._setState('paused')
  }

  resume() {
    if (this.state !== 'paused') return
    if (this._audio) this._audio.play()
    else window.speechSynthesis.resume()
    this._setState('playing')
    this._startTick()
  }

  toggle() {
    if (this.state === 'playing') this.pause()
    else if (this.state === 'paused') this.resume()
    else this.play(this.index)
  }

  setRate(rate) {
    this.rate = rate
    if (this._audio) {
      this._audio.playbackRate = rate
    } else if (this.state === 'playing' || this.state === 'paused') {
      // SpeechSynthesis 无法中途改速,从当前句重新播
      const wasPlaying = this.state === 'playing'
      if (wasPlaying) this.play(this.index)
    }
  }

  skip(deltaSeconds) {
    // 按估算时间轴换算成句子位置
    const d = this.durations()
    let target = this.elapsedSeconds() + deltaSeconds
    let acc = 0
    let idx = 0
    for (; idx < d.length; idx++) {
      if (acc + d[idx] > target) break
      acc += d[idx]
    }
    idx = Math.max(0, Math.min(idx, this.sentences.length - 1))
    this.play(idx)
  }

  seekRatio(ratio) {
    const total = this.totalSeconds()
    const d = this.durations()
    let target = total * Math.max(0, Math.min(1, ratio))
    let acc = 0
    let idx = 0
    for (; idx < d.length; idx++) {
      if (acc + d[idx] > target) break
      acc += d[idx]
    }
    idx = Math.max(0, Math.min(idx, this.sentences.length - 1))
    this.play(idx)
  }

  stop(resetState = true) {
    this._generation++
    this._stopTick()
    if (this._audio) {
      this._audio.pause()
      this._audio = null
    }
    window.speechSynthesis?.cancel?.()
    this._utterance = null
    if (resetState) this._setState('idle')
  }

  destroy() {
    this.stop()
  }
}
