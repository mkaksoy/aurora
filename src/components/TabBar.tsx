import { X, FileCode2 } from 'lucide-react'
import { useIDEStore } from '@/store/ide-store'
import { cn } from '@/lib/utils'

function getTabIcon(name: string) {
  if (name.endsWith('.kt')) {
    return (
      <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none">
        <path 
          d="M12 2L2 12l10 10 10-10L12 2z" 
          fill="var(--primary)" 
        />
        <path 
          d="M12 2L2 12h10V2z" 
          fill="var(--accent)" 
        />
      </svg>
    )
  }
  return <FileCode2 size={16} className="shrink-0 text-muted-foreground" />
}

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useIDEStore()
  
  if (tabs.length === 0) return null
  
  return (
    <div 
      className="flex items-center h-9 overflow-x-auto"
      style={{ background: 'var(--editor-gutter)' }}
    >
      {tabs.map((tab) => (
        <div
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={cn(
            "group flex items-center gap-2 h-full px-3 border-r border-border cursor-pointer transition-colors min-w-0",
            activeTabId === tab.id 
              ? "bg-(--editor-bg) text-foreground" 
              : "bg-transparent text-muted-foreground hover:bg-(--editor-bg)/50"
          )}
        >
          {getTabIcon(tab.name)}
          <span className="text-sm truncate max-w-30 select-none">{tab.name}</span>
          {tab.isDirty && (
            <div className="w-2 h-2 rounded-full bg-primary" />
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              closeTab(tab.id)
            }}
            className="hover:bg-secondary rounded p-0.5 transition-opacity cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
