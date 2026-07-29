import React, { useEffect, useState } from 'react'
import { useStore } from '../store/AppStore'
import { listVoices } from '../lib/tts'

const MODELS = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8(默认,质量最好)' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5(均衡)' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5(快且省)' },
]

export default function SettingsModal({ onClose }) {
  const { state, dispatch } = useStore()
  const [llm, setLlm] = useState({ ...state.settings.llm })
  const [tts, setTts] = useState({ ...state.settings.tts })
  const [voices, setVoices] = useState({ zh: [], en: [] })

  // 枚举系统语音(部分浏览器异步加载,需监听 voiceschanged)
  useEffect(() => {
    const load = () => setVoices({ zh: listVoices('zh'), en: listVoices('en') })
    load()
    window.speechSynthesis?.addEventListener?.('voiceschanged', load)
    return () => window.speechSynthesis?.removeEventListener?.('voiceschanged', load)
  }, [])

  const save = () => {
    dispatch({ type: 'updateSettings', patch: { llm, tts } })
    onClose()
  }

  const exportData = () => {
    const raw = localStorage.getItem('wrc-state-v1') || '{}'
    const blob = new Blob([raw], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const d = new Date()
    a.href = url
    a.download = `阅读伴侣备份-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importData = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (!Array.isArray(data.articles) || !Array.isArray(data.magazines)) {
        throw new Error('文件格式不对')
      }
      if (
        !window.confirm(
          `导入包含 ${data.magazines.length} 份周刊、${data.articles.length} 篇文章的数据,将覆盖本设备现有数据。继续吗?`
        )
      ) {
        return
      }
      localStorage.setItem('wrc-state-v1', text)
      window.location.reload()
    } catch (err) {
      alert('导入失败:' + err.message)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-ink-800 rounded-xl shadow-xl w-full max-w-lg p-6 space-y-5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">设置</h2>

        <section className="space-y-2">
          <h3 className="text-sm font-medium text-ink-700/70 dark:text-ink-100/70">
            LLM API(文章拆分 / 摘要 / 语境释义)
          </h3>
          <label className="block text-sm">
            Anthropic API Key
            <input
              type="password"
              className="mt-1 w-full rounded-md border border-ink-200 dark:border-ink-700 bg-transparent px-2 py-1.5 text-sm"
              placeholder="sk-ant-..."
              value={llm.apiKey}
              onChange={(e) => setLlm({ ...llm, apiKey: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            模型
            <select
              className="mt-1 w-full rounded-md border border-ink-200 dark:border-ink-700 bg-transparent px-2 py-1.5 text-sm dark:bg-ink-800"
              value={llm.model}
              onChange={(e) => setLlm({ ...llm, model: e.target.value })}
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-ink-700/50 dark:text-ink-100/50">
            Key 只保存在本机浏览器中。未配置时,拆分退化为启发式规则,摘要显示首句摘录,语境释义不可用。
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium text-ink-700/70 dark:text-ink-100/70">
            语音朗读(TTS)
          </h3>
          <label className="block text-sm">
            引擎
            <select
              className="mt-1 w-full rounded-md border border-ink-200 dark:border-ink-700 bg-transparent px-2 py-1.5 text-sm dark:bg-ink-800"
              value={tts.provider}
              onChange={(e) => setTts({ ...tts, provider: e.target.value })}
            >
              <option value="browser">浏览器内置语音(免费)</option>
              <option value="api">TTS API(OpenAI 兼容接口)</option>
            </select>
          </label>
          {tts.provider === 'browser' && (
            <>
              {['zh', 'en'].map((lg) => (
                <label key={lg} className="block text-sm">
                  {lg === 'zh' ? '中文音色' : '英文音色'}
                  <select
                    className="mt-1 w-full rounded-md border border-ink-200 dark:border-ink-700 bg-transparent px-2 py-1.5 text-sm dark:bg-ink-800"
                    value={lg === 'zh' ? tts.voiceZh || '' : tts.voiceEn || ''}
                    onChange={(e) =>
                      setTts(
                        lg === 'zh'
                          ? { ...tts, voiceZh: e.target.value }
                          : { ...tts, voiceEn: e.target.value }
                      )
                    }
                  >
                    <option value="">自动挑选(推荐音质最好的)</option>
                    {voices[lg].map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name} ({v.lang}){v.localService ? '' : ' · 在线'}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <p className="text-xs text-ink-700/50 dark:text-ink-100/50">
                音质取决于系统自带语音。Mac 用户可在「系统设置 → 辅助功能 → 朗读内容 →
                系统声音 → 管理声音」下载增强版/Siri 声音,下载后在上面选择即可,流畅度提升明显。
                想要更自然的效果可切换到 TTS API。
              </p>
            </>
          )}
          {tts.provider === 'api' && (
            <>
              <label className="block text-sm">
                Base URL
                <input
                  className="mt-1 w-full rounded-md border border-ink-200 dark:border-ink-700 bg-transparent px-2 py-1.5 text-sm"
                  placeholder="https://api.openai.com/v1"
                  value={tts.baseUrl}
                  onChange={(e) => setTts({ ...tts, baseUrl: e.target.value })}
                />
              </label>
              <label className="block text-sm">
                API Key
                <input
                  type="password"
                  className="mt-1 w-full rounded-md border border-ink-200 dark:border-ink-700 bg-transparent px-2 py-1.5 text-sm"
                  value={tts.apiKey}
                  onChange={(e) => setTts({ ...tts, apiKey: e.target.value })}
                />
              </label>
              <label className="block text-sm">
                音色
                <input
                  className="mt-1 w-full rounded-md border border-ink-200 dark:border-ink-700 bg-transparent px-2 py-1.5 text-sm"
                  placeholder="alloy"
                  value={tts.voice}
                  onChange={(e) => setTts({ ...tts, voice: e.target.value })}
                />
              </label>
              <p className="text-xs text-ink-700/50 dark:text-ink-100/50">
                按句生成并缓存到本机;API 失败时自动回退浏览器语音。
              </p>
            </>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium text-ink-700/70 dark:text-ink-100/70">
            数据迁移(在手机/其他设备上查看)
          </h3>
          <p className="text-xs text-ink-700/50 dark:text-ink-100/50">
            数据保存在每台设备的浏览器里,不会自动同步。在电脑上「导出」得到一个文件,
            传到手机(微信/隔空投送均可)后在手机浏览器里打开本站「导入」即可。
            注:PDF 原件体积大,不包含在导出文件中。
          </p>
          <div className="flex gap-2">
            <button
              onClick={exportData}
              className="px-3 py-1.5 rounded-md text-sm border border-ink-200 dark:border-ink-700 hover:bg-ink-100 dark:hover:bg-ink-700"
            >
              ⬇️ 导出数据
            </button>
            <label className="px-3 py-1.5 rounded-md text-sm border border-ink-200 dark:border-ink-700 hover:bg-ink-100 dark:hover:bg-ink-700 cursor-pointer">
              ⬆️ 导入数据
              <input type="file" accept=".json" className="hidden" onChange={importData} />
            </label>
          </div>
        </section>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-sm hover:bg-ink-100 dark:hover:bg-ink-700"
          >
            取消
          </button>
          <button
            onClick={save}
            className="px-4 py-1.5 rounded-md text-sm bg-ink-800 text-white dark:bg-ink-100 dark:text-ink-900 hover:opacity-90"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
