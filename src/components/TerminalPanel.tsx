import { useState } from 'react'
import { Terminal as TerminalIcon, X, AlertCircle, FileText, ChevronUp, ChevronDown } from 'lucide-react'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { useIDEStore } from '@/store/ide-store'
import { cn } from '@/lib/utils'
import { getLanguage } from './explorer/fileExplorerUtils'

type TerminalTab = 'terminal' | 'problems' | 'output'

type TerminalLine = { id: string; type: 'output' | 'success' | 'error'; content: string }

const terminalHistory: TerminalLine[] = [
  { id: '1', type: 'output', content: 'Aurora Terminal v1.0.0' },
  { id: '2', type: 'output', content: '> gradle build' },
  { id: '3', type: 'output', content: '> Task :compileKotlin' },
  { id: '4', type: 'success', content: 'BUILD SUCCESSFUL in 2s' },
  { id: '5', type: 'output', content: '' },
  { id: '6', type: 'output', content: '> gradle run' },
  { id: '7', type: 'success', content: 'Welcome to Aurora!' },
  { id: '8', type: 'success', content: 'Hello, World!' },
]

export function TerminalPanel() {
  const {
    diagnosticItems,
    isTerminalOpen,
    openFile,
    setPendingReveal,
    toggleTerminal,
  } = useIDEStore()
  const [activeTab, setActiveTab] = useState<TerminalTab>('terminal')
  
  const tabs: { id: TerminalTab; label: string; icon: typeof TerminalIcon }[] = [
    { id: 'terminal', label: 'Terminal', icon: TerminalIcon },
    { id: 'problems', label: 'Problems', icon: AlertCircle },
    { id: 'output', label: 'Output', icon: FileText },
  ]

  async function openDiagnostic(path: string, line: number, column: number) {
    const content = await readTextFile(path).catch(() => '')
    const name = fileNameFromPath(path)

    openFile(
      {
        id: path,
        name,
        type: 'file',
        content,
        language: getLanguage(name),
      },
      path,
    )
    setPendingReveal({ path, line, column })
  }
  
  if (!isTerminalOpen) {
    return (
      <div 
        className="h-8 flex items-center px-3 border-t border-border cursor-pointer hover:bg-secondary/50"
        style={{ background: 'var(--terminal-bg)' }}
        onClick={toggleTerminal}
      >
        <ChevronUp size={16} className="mr-2 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Terminal</span>
      </div>
    )
  }
  
  return (
    <div 
      className="flex flex-col border-t border-border"
      style={{ background: 'var(--terminal-bg)', height: '200px' }}
    >
      {/* Tab bar */}
      <div className="flex items-center h-9 border-b border-border px-2 gap-1 shrink-0 resize-y">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 text-xs rounded-sm transition-colors",
              activeTab === tab.id 
                ? "bg-secondary text-foreground" 
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
        <div className="flex-1" />
        <button 
          onClick={toggleTerminal}
          className="p-1 hover:bg-secondary rounded text-muted-foreground hover:text-foreground"
        >
          <ChevronDown size={16} />
        </button>
        <button className="p-1 hover:bg-secondary rounded text-muted-foreground hover:text-foreground">
          <X size={16} />
        </button>
      </div>
      
      {/* Terminal content */}
      {activeTab === 'terminal' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-auto p-3 font-mono text-sm">
            {terminalHistory.map((line) => (
              <div 
                key={line.id}
                className={cn(
                  "leading-relaxed",
                  line.type === 'output' && "text-(--terminal-fg) opacity-80",
                  line.type === 'success' && "text-(--terminal-green)",
                  line.type === 'error' && "text-(--terminal-red)"
                )}
              >
                {line.content || '\u00A0'}
              </div>
            ))}
          </div>
          
          <div className="flex items-center px-3 pb-3 gap-2">
            <span className="text-(--terminal-green) font-mono text-sm">$</span>
            <input
              type="text"
              readOnly
              className="flex-1 bg-transparent border-none outline-none font-mono text-sm text-(--terminal-fg) cursor-text"
              placeholder="Type a command..."
            />
          </div>
        </div>
      )}
      
      {activeTab === 'problems' && (
        <div className="flex-1 overflow-auto py-1">
          {diagnosticItems.length === 0 && (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              No problems detected
            </div>
          )}

          {diagnosticItems.map((item) => (
            <button
              key={item.id}
              onClick={() => openDiagnostic(item.path, item.line, item.column)}
              className="w-full grid grid-cols-[auto_1fr_auto] items-center gap-2 px-3 py-1 text-left text-xs hover:bg-secondary/60"
              title={`${item.path}:${item.line}:${item.column}`}
            >
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  item.severity === 'error' && 'bg-red-400',
                  item.severity === 'warning' && 'bg-yellow-300',
                  item.severity === 'info' && 'bg-blue-300',
                  item.severity === 'hint' && 'bg-zinc-400',
                )}
              />
              <span className="min-w-0">
                <span className="block truncate text-foreground">{item.message}</span>
                <span className="block truncate text-muted-foreground">{item.fileName}</span>
              </span>
              <span className="font-mono text-muted-foreground">
                {item.line}:{item.column}
              </span>
            </button>
          ))}
        </div>
      )}
      
      {activeTab === 'output' && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          No output
        </div>
      )}
    </div>
  )
}

function fileNameFromPath(path: string) {
  return path.replace(/\\/g, '/').split('/').pop() ?? path
}
