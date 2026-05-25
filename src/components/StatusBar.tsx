import { AlertCircle, CheckCircle2, GitBranch, Loader2, PauseCircle } from 'lucide-react'
import { useIDEStore } from '@/store/ide-store'

export function StatusBar() {
  const {
    tabs,
    activeTabId,
    cursorPosition,
    lspStatus,
    lspMessage,
    lspIndexedFiles,
    lspTotalFiles,
    diagnosticCounts,
  } = useIDEStore()
  const activeTab = tabs.find(t => t.id === activeTabId)
  const lspColor =
    lspStatus === 'ready'
      ? 'text-(--terminal-green)'
      : lspStatus === 'error'
        ? 'text-red-400'
        : lspStatus === 'starting'
          ? 'text-yellow-300'
          : 'opacity-70'
  const LspIcon =
    lspStatus === 'ready'
      ? CheckCircle2
      : lspStatus === 'error'
        ? AlertCircle
        : lspStatus === 'starting'
          ? Loader2
          : PauseCircle
  const diagnosticsLabel = formatDiagnostics(diagnosticCounts)
  const lspLabel = formatLspLabel(lspStatus, lspIndexedFiles, lspTotalFiles)
  
  return (
    <div 
      className="h-6 flex items-center justify-between px-3 text-xs shrink-0"
      style={{ 
        background: 'var(--statusbar-bg)',
        color: 'var(--statusbar-fg)'
      }}
    >
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <GitBranch size={14} />
          <span>main</span>
        </div>
        <span className={diagnosticCounts.errors > 0 ? 'text-red-200' : 'opacity-70'}>
          {diagnosticsLabel}
        </span>
        <span className={`flex items-center gap-1 ${lspColor}`} title={lspMessage}>
          <LspIcon size={13} className={lspStatus === 'starting' ? 'animate-spin' : ''} />
          {lspLabel}
        </span>
      </div>
      
      <div className="flex items-center gap-4">
        {activeTab && (
          <>
            <span>Ln {cursorPosition.line}, Col {cursorPosition.column}</span>
            <span>UTF-8</span>
            <span>Kotlin</span>
          </>
        )}
        <span className="opacity-70">Aurora</span>
      </div>
    </div>
  )
}

function formatDiagnostics(counts: {
  errors: number
  warnings: number
  infos: number
  hints: number
}) {
  const extra = counts.infos + counts.hints
  const suffix = extra > 0 ? `, ${extra} info` : ''

  return `${counts.errors} errors, ${counts.warnings} warnings${suffix}`
}

function formatLspLabel(
  status: 'stopped' | 'starting' | 'ready' | 'error',
  indexed: number,
  total: number,
) {
  if (status === 'starting') return 'Kotlin LSP: starting'
  if (status === 'error') return 'Kotlin LSP: error'
  if (status === 'stopped') return 'Kotlin LSP: idle'
  if (total > 0 && indexed < total) return `Kotlin LSP: indexing ${indexed}/${total}`
  if (total > 0) return `Kotlin LSP: ready (${total} indexed)`
  return 'Kotlin LSP: ready'
}
