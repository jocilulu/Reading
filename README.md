# 周刊阅读伴侣

个人使用的周刊阅读与听读 Web 应用:每周上传想看的周刊(中文或外文),应用帮你拆分文章、生成摘要、朗读正文,并辅助学习外语生词和做笔记。

## 快速开始

```bash
npm install
npm run dev      # 开发模式
npm run build    # 生产构建(输出到 dist/)
```

打开后建议先进入左下角「⚙️ 设置」:

- **LLM API**:填入 Anthropic API Key(仅保存在本机浏览器)。用于 AI 拆分文章、生成摘要标签、生词语境释义。未配置时应用仍可用,自动降级为启发式拆分 + 首句摘录,语境释义不可用。
- **TTS**:默认使用浏览器内置语音(免费、无需配置);也可切换为 OpenAI 兼容的 TTS API,按句生成并缓存到本机 IndexedDB,失败自动回退浏览器语音。

## 功能一览

- **上传与拆分**:支持 PDF / EPUB / TXT / 网页链接 / 粘贴文本;按周归档(周一为起点),同一周可传多份周刊;拆分结果可手动合并、再拆分、改标题后确认保存。
- **每周概览**(默认首页):文章卡片(AI 摘要、标签、语言、预估读听时长、状态),按标签筛选、拖拽排序、⭐ 优先置顶。
- **阅读页**:Notion 风格排版(约 680px 正文宽);顶部固定 TTS 播放器(播放/暂停、进度拖动、0.75–2x 倍速、±15 秒);播放时当前句高亮并自动滚动跟随;点击句子空白处从该句播放。
- **生词**:外文文章单击单词弹出词卡(词典释义 + LLM 语境含义 + 例句),一键加入生词本;生词本按周刊分组、保留出处句、可标记已掌握;查询结果缓存,同词同句不重复调用。
- **笔记**:选中文字高亮(3 色)或批注(段落右侧气泡);快捷键 `N` 呼出文章速记侧栏(支持基础 Markdown);「我的笔记」按 周 → 周刊 → 文章 汇总,一键跳回原文。
- **收听统计**:本周收听总时长(与上周对比)、每日柱状图、读完/听完篇数、历史周趋势折线;只计入实际播放时间,按周汇总。

## 技术说明

- React 18 + Vite + Tailwind CSS,浅色/深色主题。
- 所有数据(周刊、文章、笔记、生词、收听记录、设置)持久化在 `localStorage`,TTS 音频缓存在 IndexedDB,刷新不丢失。
- 所有 LLM 调用集中封装在 `src/lib/llm.js`(Anthropic Messages API + 结构化输出),换模型/供应商只需改这一个文件;TTS 封装在 `src/lib/tts.js`。
- 移动端基础适配(概览页与阅读页可用)。

## 目录结构

```
src/
  lib/        llm.js(LLM 封装)· tts.js(句级播放引擎)· parse.js(解析与拆分)
              dict.js(词典+语境查询)· storage.js(持久化)· utils.js
  store/      AppStore.jsx(全局状态 + 路由 + 持久化)
  components/ Sidebar · Breadcrumbs · SettingsModal
    upload/   UploadModal(上传 + 拆分确认)
    overview/ OverviewPage(卡片、筛选、拖拽)
    reader/   ReaderPage · AudioPlayer · WordPopover · NotesSidebar
    notes/    NotesPage(汇总)
    vocab/    VocabPage(生词本)
    stats/    StatsPage(统计图表,手写 SVG)
    archive/  ArchivePage(往期归档)
```
