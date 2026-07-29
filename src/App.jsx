import React, { useState } from 'react'
import { useStore } from './store/AppStore'
import Sidebar from './components/Sidebar'
import Breadcrumbs from './components/Breadcrumbs'
import OverviewPage from './components/overview/OverviewPage'
import ArchivePage from './components/archive/ArchivePage'
import ReaderPage from './components/reader/ReaderPage'
import NotesPage from './components/notes/NotesPage'
import VocabPage from './components/vocab/VocabPage'
import StatsPage from './components/stats/StatsPage'
import SettingsModal from './components/SettingsModal'

export default function App() {
  const { state } = useStore()
  // 手机上默认收起侧边栏,避免占据大半屏幕
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 768
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const page = state.route.page
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        onOpenSettings={() => setSettingsOpen(true)}
        onNavigate={() => {
          if (isMobile) setSidebarOpen(false) // 手机上选完页面自动收起
        }}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Breadcrumbs
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
        />
        <main className="flex-1 overflow-y-auto">
          {page === 'overview' && <OverviewPage />}
          {page === 'archive' && <ArchivePage />}
          {page === 'reader' && <ReaderPage key={state.route.articleId} />}
          {page === 'notes' && <NotesPage />}
          {page === 'vocab' && <VocabPage />}
          {page === 'stats' && <StatsPage />}
        </main>
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
