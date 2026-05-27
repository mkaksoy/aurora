import { invoke } from '@tauri-apps/api/core'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import * as monaco from 'monaco-editor'
import { FileNode, useIDEStore } from '@/store/ide-store'
import {
  connection,
  isIndexingComplete,
  activeMonacoInstance,
  openedUris,
  watchedFilePaths,
  DEBUG_LSP_LOGS,
  fileUriFromPath,
  isKotlinPath,
} from './state'
import { onFileCreated, onFileModified, onFileDeleted, openTextDocument } from './documents'

// ─── Tauri File Watcher ───────────────────────────────────────────────────────

let watcherUnlisten: UnlistenFn | null = null

export interface FileWatchEvent {
  kind: 'create' | 'modify' | 'delete' | 'rename'
  path: string
  newPath?: string
}

export async function startFileWatcher(workspacePath: string) {
  await stopFileWatcher()

  try {
    await invoke('watch_workspace', { path: workspacePath })

    watcherUnlisten = await listen<FileWatchEvent>('workspace://file-changed', (event) => {
      void handleFileWatchEvent(event.payload)
    })

    if (DEBUG_LSP_LOGS) console.debug('[LSP] file watcher started', workspacePath)
  } catch (error) {
    console.warn('[LSP] file watcher could not start', error)
  }
}

export async function stopFileWatcher() {
  if (watcherUnlisten) {
    watcherUnlisten()
    watcherUnlisten = null
  }

  try {
    await invoke('unwatch_workspace')
  } catch {
    // ignore
  }

  watchedFilePaths.clear()
}

async function handleFileWatchEvent(event: FileWatchEvent) {
  if (!connection || !isIndexingComplete) return

  const { kind, path, newPath } = event

  if (!isKotlinPath(path) && !(newPath && isKotlinPath(newPath))) return

  if (DEBUG_LSP_LOGS) console.debug('[LSP] file watch event', event)

  const monacoInstance = activeMonacoInstance

  switch (kind) {
    case 'create':
      await onFileCreated(path, monacoInstance)
      break
    case 'modify':
      await onFileModified(path, monacoInstance)
      break
    case 'delete':
      onFileDeleted(path, monacoInstance)
      break
    case 'rename':
      onFileDeleted(path, monacoInstance)
      if (newPath) await onFileCreated(newPath, monacoInstance)
      break
  }

  notifyWorkspaceFileChange(kind, path, newPath)
}

function notifyWorkspaceFileChange(
  kind: FileWatchEvent['kind'],
  path: string,
  newPath?: string,
) {
  if (!connection) return

  const typeMap: Record<FileWatchEvent['kind'], number> = {
    create: 1,
    modify: 2,
    delete: 3,
    rename: 3,
  }

  const changes: any[] = [{ uri: fileUriFromPath(path), type: typeMap[kind] }]

  if (kind === 'rename' && newPath) {
    changes.push({ uri: fileUriFromPath(newPath), type: 1 })
  }

  connection.sendNotification('workspace/didChangeWatchedFiles', { changes })
}

// ─── Store Watcher ────────────────────────────────────────────────────────────

let storeUnsubscribe: (() => void) | null = null
let previousKotlinUris = new Set<string>()

export function startWatchingStoreFiles() {
  storeUnsubscribe?.()

  previousKotlinUris = new Set(
    collectKotlinFiles(useIDEStore.getState().files).map((f) => fileUriFromPath(f.id)),
  )

  storeUnsubscribe = useIDEStore.subscribe(async (state, prevState) => {
    if (state.files === prevState.files) return
    if (!connection || !isIndexingComplete) return

    const currentFiles = collectKotlinFiles(state.files)
    const currentUris = new Set(currentFiles.map((f) => fileUriFromPath(f.id)))

    // Yeni eklenen dosyalar
    for (const uri of currentUris) {
      if (!previousKotlinUris.has(uri)) {
        const file = currentFiles.find((f) => fileUriFromPath(f.id) === uri)
        if (file?.content !== undefined && !openedUris.has(uri)) {
          openTextDocument(uri, file.content, 'kotlin', 1)
        }
        notifyWorkspaceFileChange('create', uriToPath(uri))
        if (DEBUG_LSP_LOGS) console.debug('[LSP] store: file added', uri)
      }
    }

    // Silinen dosyalar
    for (const uri of previousKotlinUris) {
      if (!currentUris.has(uri)) {
        onFileDeleted(uriToPath(uri), activeMonacoInstance)
        notifyWorkspaceFileChange('delete', uriToPath(uri))
        if (DEBUG_LSP_LOGS) console.debug('[LSP] store: file removed', uri)
      }
    }

    // İçeriği değişen dosyalar
    for (const uri of currentUris) {
      if (!previousKotlinUris.has(uri)) continue

      const currentFile = currentFiles.find((f) => fileUriFromPath(f.id) === uri)
      if (!currentFile?.content) continue

      const monacoInstance = activeMonacoInstance
      if (monacoInstance) {
        const monacoUri = monacoInstance.Uri.parse(uri)
        if (monacoInstance.editor.getModel(monacoUri)) continue
      }

      if (openedUris.has(uri)) {
        connection.sendNotification('textDocument/didChange', {
          textDocument: { uri, version: Date.now() },
          contentChanges: [{ text: currentFile.content }],
        })
      }
    }

    previousKotlinUris = currentUris
  })
}

export function stopWatchingStoreFiles() {
  storeUnsubscribe?.()
  storeUnsubscribe = null
  previousKotlinUris = new Set()
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uriToPath(uri: string): string {
  return monaco.Uri.parse(uri).fsPath
}

function collectKotlinFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []

  for (const node of nodes) {
    if (node.type === 'folder') {
      files.push(...collectKotlinFiles(node.children ?? []))
    } else if (isIndexableKotlinFile(node)) {
      files.push(node)
    }
  }

  return files
}

function isIndexableKotlinFile(node: FileNode): boolean {
  if (node.name.endsWith('.gradle.kts')) return false
  return node.language === 'kotlin' || node.name.endsWith('.kt') || node.name.endsWith('.kts')
}