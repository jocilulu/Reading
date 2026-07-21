// LLM API 封装模块
//
// 所有对大模型的调用都集中在这里,方便之后替换模型/供应商。
// 默认使用 Anthropic Claude(浏览器直连,需在设置里填 API Key)。
// 每个能力暴露为一个独立函数:
//   - splitArticlesLLM(text)        文章拆分辅助
//   - summarizeArticle(article)     一句话摘要 + 标签
//   - explainWordInContext(...)     语境释义
//
// 未配置 API Key 时,各函数抛出 LLMNotConfiguredError,调用方自行降级。

import Anthropic from '@anthropic-ai/sdk'

export class LLMNotConfiguredError extends Error {
  constructor() {
    super('LLM API 未配置,请在设置中填写 API Key')
    this.name = 'LLMNotConfiguredError'
  }
}

let _settings = { apiKey: '', model: 'claude-opus-4-8' }

export function configureLLM(settings) {
  _settings = { ..._settings, ...settings }
}

export function llmConfigured() {
  return Boolean(_settings.apiKey)
}

function getClient() {
  if (!_settings.apiKey) throw new LLMNotConfiguredError()
  return new Anthropic({
    apiKey: _settings.apiKey,
    // 个人工具、Key 由用户本人持有,允许浏览器直连
    dangerouslyAllowBrowser: true,
  })
}

function model() {
  return _settings.model || 'claude-opus-4-8'
}

async function createJSON({ system, prompt, schema, maxTokens = 4096 }) {
  const client = getClient()
  const response = await client.messages.create({
    model: model(),
    max_tokens: maxTokens,
    system,
    output_config: {
      format: { type: 'json_schema', schema },
    },
    messages: [{ role: 'user', content: prompt }],
  })
  if (response.stop_reason === 'refusal') {
    throw new Error('模型拒绝了本次请求')
  }
  const text = response.content.find((b) => b.type === 'text')?.text
  if (!text) throw new Error('模型未返回内容')
  return JSON.parse(text)
}

// ---- 文章拆分 ----

const SPLIT_SCHEMA = {
  type: 'object',
  properties: {
    articles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          author: { type: 'string' },
          firstWords: {
            type: 'string',
            description: '这篇文章正文第一句的前 20 个字符,原样摘抄,用于定位拆分点',
          },
        },
        required: ['title', 'author', 'firstWords'],
        additionalProperties: false,
      },
    },
  },
  required: ['articles'],
  additionalProperties: false,
}

export async function splitArticlesLLM(text) {
  // 对长文本只取前一部分做目录识别,拆分点通过 firstWords 在原文中定位
  const sample = text.length > 60000 ? text.slice(0, 60000) : text
  return createJSON({
    system:
      '你是一个杂志内容解析助手。用户给你一份周刊的纯文本,里面包含多篇文章。' +
      '请识别每篇文章的标题、作者(没有则留空字符串)以及正文第一句的开头原文。' +
      '严格按出现顺序输出。不要虚构文本中不存在的文章。',
    prompt: sample,
    schema: SPLIT_SCHEMA,
    maxTokens: 8192,
  })
}

// ---- 摘要与标签 ----

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '不超过 50 字的中文一句话摘要' },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: '2-3 个中文主题标签,每个 2-6 字',
    },
  },
  required: ['summary', 'tags'],
  additionalProperties: false,
}

export async function summarizeArticle({ title, content }) {
  const body = content.length > 12000 ? content.slice(0, 12000) + '…' : content
  return createJSON({
    system:
      '你为周刊文章生成卡片信息:一句话中文摘要(50 字以内)和 2-3 个中文主题标签。' +
      '摘要要概括文章核心观点,不要以"本文"开头。',
    prompt: `标题:${title}\n\n正文:\n${body}`,
    schema: SUMMARY_SCHEMA,
    maxTokens: 1024,
  })
}

// ---- 段落翻译(双语对照) ----

const TRANSLATE_SCHEMA = {
  type: 'object',
  properties: {
    translations: {
      type: 'array',
      items: { type: 'string' },
      description: '与输入段落一一对应的中文译文,数量和顺序必须完全一致',
    },
  },
  required: ['translations'],
  additionalProperties: false,
}

export async function translateParagraphs(paragraphs) {
  const numbered = paragraphs.map((p, i) => `[${i + 1}] ${p}`).join('\n\n')
  const { translations } = await createJSON({
    system:
      '你是一位优秀的外刊译者。把用户给出的每个编号段落翻译成流畅、准确的简体中文,' +
      '保留原文的语气和信息密度,不增删内容。输出的译文数组必须与输入段落数量、顺序完全一致,不包含编号。',
    prompt: numbered,
    schema: TRANSLATE_SCHEMA,
    maxTokens: 16000,
  })
  if (!Array.isArray(translations) || translations.length !== paragraphs.length) {
    throw new Error('译文段落数与原文不一致')
  }
  return translations
}

// ---- 语境释义 ----

const WORD_SCHEMA = {
  type: 'object',
  properties: {
    contextMeaning: {
      type: 'string',
      description: '这个词在给定句子语境中的含义,用中文解释,1-2 句',
    },
    example: {
      type: 'string',
      description: '一个地道的原语言例句(不要复述原句)',
    },
    baseMeaning: {
      type: 'string',
      description: '词性 + 常用义的简短中文说明,如 "n. 织物;结构"',
    },
  },
  required: ['contextMeaning', 'example', 'baseMeaning'],
  additionalProperties: false,
}

export async function explainWordInContext({ word, sentence, language }) {
  return createJSON({
    system:
      '你是一个外语学习助手。用户在阅读外刊时点击了一个单词,给你整句话作为上下文。' +
      '解释这个词:它的基本释义(词性+常用义)、它在这句话语境中的具体含义,以及一个地道例句。',
    prompt: `语言:${language}\n单词:${word}\n所在句子:${sentence}`,
    schema: WORD_SCHEMA,
    maxTokens: 1024,
  })
}
