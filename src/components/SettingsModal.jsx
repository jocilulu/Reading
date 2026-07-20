import React, { useState } from 'react'
import { useStore } from '../store/AppStore'

const MODELS = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8(默认,质量最好)' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5(均衡)' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5(快且省)' },
]

export default function SettingsModal({ onClose }) {
  const { state, dispatch } = useStore()
  const [llm, setLlm] = useState({ ...state.settings.llm })
  const [tts, setTts] = useState({ ...state.settings.tts })

  const save = () => {
    dispatch({ type: 'updateSettings', patch: { llm, tts } })
    onClose()
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
