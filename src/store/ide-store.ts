import { create } from 'zustand'

export interface FileNode {
  id: string
  name: string
  type: 'file' | 'folder'
  children?: FileNode[]
  content?: string
  language?: string
}

export interface Tab {
  id: string
  name: string
  path: string
  content: string
  language: string
  isDirty: boolean
}

export interface DiagnosticCounts {
  errors: number
  warnings: number
  infos: number
  hints: number
}

export interface DiagnosticItem {
  id: string
  uri: string
  path: string
  fileName: string
  message: string
  severity: 'error' | 'warning' | 'info' | 'hint'
  line: number
  column: number
}

export interface RevealTarget {
  path: string
  line: number
  column: number
}

interface IDEState {
  files: FileNode[]
  expandedFolders: Set<string>
  selectedFileId: string | null

  tabs: Tab[]
  activeTabId: string | null

  projectRoot: string | null   // ← eklendi
  lspStatus: 'stopped' | 'starting' | 'ready' | 'error'
  lspMessage: string
  lspIndexedFiles: number
  lspTotalFiles: number
  diagnosticCounts: DiagnosticCounts
  diagnosticItems: DiagnosticItem[]
  pendingReveal: RevealTarget | null

  sidebarWidth: number
  terminalHeight: number
  isTerminalOpen: boolean
  activePanel: 'explorer' | 'search' | 'git' | 'debug' | 'extensions'

  cursorPosition: { line: number; column: number }

  toggleFolder: (folderId: string) => void
  openFile: (file: FileNode, path: string) => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  updateTabContent: (tabId: string, content: string) => void
  saveTab: (tabId: string) => void
  setSidebarWidth: (width: number) => void
  setTerminalHeight: (height: number) => void
  toggleTerminal: () => void
  setActivePanel: (panel: IDEState['activePanel']) => void
  setCursorPosition: (pos: { line: number; column: number }) => void
  setFiles: (files: FileNode[]) => void
  setProjectRoot: (root: string) => void   // ← eklendi
  setLspStatus: (status: IDEState['lspStatus'], message?: string) => void
  setLspIndexProgress: (indexed: number, total: number, message?: string) => void
  setDiagnosticCounts: (counts: DiagnosticCounts) => void
  setDiagnosticsForUri: (uri: string, items: DiagnosticItem[]) => void
  clearDiagnostics: () => void
  setPendingReveal: (target: RevealTarget | null) => void
}

export const initialFiles: FileNode[] = []

export const useIDEStore = create<IDEState>((set) => ({
  files: initialFiles,
  expandedFolders: new Set(['1', '2', '3', '4']),
  selectedFileId: null,

  tabs: [],
  activeTabId: null,

  projectRoot: null,   // ← eklendi
  lspStatus: 'stopped',
  lspMessage: 'Kotlin LSP is idle',
  lspIndexedFiles: 0,
  lspTotalFiles: 0,
  diagnosticCounts: { errors: 0, warnings: 0, infos: 0, hints: 0 },
  diagnosticItems: [],
  pendingReveal: null,

  sidebarWidth: 260,
  terminalHeight: 200,
  isTerminalOpen: true,
  activePanel: 'explorer',

  cursorPosition: { line: 1, column: 1 },

  toggleFolder: (folderId) => set((state) => {
    const newExpanded = new Set(state.expandedFolders)
    if (newExpanded.has(folderId)) {
      newExpanded.delete(folderId)
    } else {
      newExpanded.add(folderId)
    }
    return { expandedFolders: newExpanded }
  }),

  openFile: (file, path) => set((state) => {
    const existingTab = state.tabs.find(t => t.id === file.id)
    if (existingTab) {
      return { activeTabId: file.id, selectedFileId: file.id }
    }
    const newTab: Tab = {
      id: file.id,
      name: file.name,
      path,
      content: file.content || '',
      language: file.language || 'text',
      isDirty: false,
    }
    return {
      tabs: [...state.tabs, newTab],
      activeTabId: file.id,
      selectedFileId: file.id,
    }
  }),

  closeTab: (tabId) => set((state) => {
    const newTabs = state.tabs.filter(t => t.id !== tabId)
    let newActiveTabId = state.activeTabId
    if (state.activeTabId === tabId) {
      const closedIndex = state.tabs.findIndex(t => t.id === tabId)
      newActiveTabId = newTabs[Math.min(closedIndex, newTabs.length - 1)]?.id || null
    }
    return { tabs: newTabs, activeTabId: newActiveTabId }
  }),

  setActiveTab: (tabId) => set({ activeTabId: tabId, selectedFileId: tabId }),

  updateTabContent: (tabId, content) => set((state) => ({
    tabs: state.tabs.map(t =>
      t.id === tabId ? { ...t, content, isDirty: true } : t
    ),
  })),

  saveTab: (tabId) => set((state) => ({
    tabs: state.tabs.map(t =>
      t.id === tabId ? { ...t, isDirty: false } : t
    ),
  })),

  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setTerminalHeight: (height) => set({ terminalHeight: height }),
  toggleTerminal: () => set((state) => ({ isTerminalOpen: !state.isTerminalOpen })),
  setActivePanel: (panel) => set({ activePanel: panel }),
  setCursorPosition: (pos) => set({ cursorPosition: pos }),
  setFiles: (files) => set({ files }),
  setProjectRoot: (root) => set({ projectRoot: root }),   // ← eklendi
  setLspStatus: (status, message) => set({
    lspStatus: status,
    lspMessage: message ?? `Kotlin LSP ${status}`,
  }),
  setLspIndexProgress: (indexed, total, message) => set({
    lspIndexedFiles: indexed,
    lspTotalFiles: total,
    lspMessage: message ?? (total > 0
      ? `Indexing Kotlin files (${indexed}/${total})`
      : 'No Kotlin files found'),
  }),
  setDiagnosticCounts: (counts) => set({ diagnosticCounts: counts }),
  setDiagnosticsForUri: (uri, items) => set((state) => ({
    diagnosticItems: [
      ...state.diagnosticItems.filter((item) => item.uri !== uri),
      ...items,
    ].sort((a, b) => {
      if (a.path !== b.path) return a.path.localeCompare(b.path)
      if (a.line !== b.line) return a.line - b.line
      return a.column - b.column
    }),
  })),
  clearDiagnostics: () => set({
    diagnosticItems: [],
    diagnosticCounts: { errors: 0, warnings: 0, infos: 0, hints: 0 },
  }),
  setPendingReveal: (target) => set({ pendingReveal: target }),
}))
