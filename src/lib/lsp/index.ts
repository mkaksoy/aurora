import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import * as monaco from 'monaco-editor'
import { createMessageConnection } from 'vscode-jsonrpc/browser'
import { FileNode, useIDEStore } from '@/store/ide-store'
import { TauriMessageReader, TauriMessageWriter } from './transport'
import {
  connection, starting, reader, writer, stopping,
  activeMonacoInstance, activeWorkspacePath, registeredForMonaco,
  openedUris, attachedModelUris, diagnosticEnabledUris,
  diagnosticCountsByUri, diagnosticRefreshTimers,
  providerDisposables, modelDisposables, eventUnlisteners, watchedFilePaths,
  DEBUG_LSP_LOGS,
  setConnection, setStarting, setReader, setWriter, setStopping,
  setActiveMonacoInstance, setActiveWorkspacePath, setRegisteredForMonaco,
  setIsIndexingComplete,
  setLspStatus,
  fileUriFromPath,
  isNoisyLspLog,
  clientCapabilities,
  tryDispose,
  isConnectionDisposedError,
} from './state'
import { applyDiagnostics } from './diagnostics'
import { attachExistingModels, attachModel, openTextDocument } from './documents'
import { registerMonacoProviders } from './providers'
import { startFileWatcher, stopFileWatcher, startWatchingStoreFiles, stopWatchingStoreFiles } from './watcher'

// ─── Public API ──────────────────────────────────────────────────────────────

export { fileUriFromPath } from './state'

export async function startKotlinLsp(
  workspacePath: string,
  monacoInstance?: typeof monaco,
): Promise<void> {
  if (monacoInstance) {
    setActiveMonacoInstance(monacoInstance)
  }

  if (connection) {
    if (activeWorkspacePath !== workspacePath) {
      await stopKotlinLsp()
    } else {
      if (monacoInstance) bindMonacoInstance(monacoInstance)
      return
    }
  }

  if (starting) {
    return starting.then(() => {
      if (monacoInstance) bindMonacoInstance(monacoInstance)
    })
  }

  const promise = startKotlinLspInner(workspacePath, monacoInstance)
    .catch((error) => {
      if (isConnectionDisposedError(error)) {
        setLspStatus('stopped', 'Kotlin LSP stopped')
        return
      }
      setLspStatus('error', String(error))
      throw error
    })
    .finally(() => {
      setStarting(null)
    })

  setStarting(promise)
  return promise
}

export async function stopKotlinLsp(): Promise<void> {
  if (stopping) return stopping

  const promise = stopKotlinLspInner().finally(() => setStopping(null))
  setStopping(promise)
  return promise
}

export function notifyDocumentSaved(path: string, text: string): void {
  if (!connection) return

  connection.sendNotification('textDocument/didSave', {
    textDocument: { uri: fileUriFromPath(path) },
    text,
  })
}

// ─── Internal ────────────────────────────────────────────────────────────────

async function startKotlinLspInner(
  workspacePath: string,
  monacoInstance?: typeof monaco,
): Promise<void> {
  setLspStatus('starting', 'Starting Kotlin LSP process')
  setActiveWorkspacePath(workspacePath)
  if (DEBUG_LSP_LOGS) console.debug('[LSP] starting', { workspacePath })

  const workspaceUri = await invoke<string>('lsp_file_uri', { path: workspacePath })

  const newReader = new TauriMessageReader()
  const newWriter = new TauriMessageWriter()
  setReader(newReader)
  setWriter(newWriter)
  await newReader.start()
  await listenToLspEvents()

  try {
    const startResult = await invoke('lsp_start', { options: { workspacePath } })
    if (DEBUG_LSP_LOGS) console.debug('[LSP] process started', startResult)
  } catch (error) {
    if (!String(error).includes('already running')) throw error

    console.warn('[LSP] stale process detected, restarting')
    await invoke('lsp_stop')
    const startResult = await invoke('lsp_start', { options: { workspacePath } })
    if (DEBUG_LSP_LOGS) console.debug('[LSP] process restarted', startResult)
  }

  const newConnection = createMessageConnection(newReader, newWriter)
  setConnection(newConnection)
  registerConnectionHandlers()
  newConnection.listen()

  const workspaceName =
    workspacePath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? 'workspace'

  const initializeResult = await newConnection.sendRequest('initialize', {
    processId: null,
    clientInfo: { name: 'Aurora', version: '0.1.0' },
    locale: 'tr',
    rootUri: workspaceUri,
    workspaceFolders: [{ uri: workspaceUri, name: workspaceName }],
    capabilities: clientCapabilities(),
    initializationOptions: {},
  })

  newConnection.sendNotification('initialized', {})
  if (DEBUG_LSP_LOGS) console.debug('[LSP] initialized', initializeResult)
  setLspStatus('ready', 'Kotlin LSP initialized')

  if (monacoInstance) bindMonacoInstance(monacoInstance)
  await indexWorkspaceKotlinFiles(workspacePath)
  await startFileWatcher(workspacePath)
}

async function stopKotlinLspInner(): Promise<void> {
  setIsIndexingComplete(false)
  stopWatchingStoreFiles()
  await stopFileWatcher()

  for (const disposable of providerDisposables.splice(0)) tryDispose(disposable)
  for (const disposable of modelDisposables.splice(0)) tryDispose(disposable)
  for (const unlisten of eventUnlisteners.splice(0)) unlisten()
  for (const timer of diagnosticRefreshTimers.values()) clearTimeout(timer)

  diagnosticRefreshTimers.clear()
  openedUris.clear()
  attachedModelUris.clear()
  diagnosticEnabledUris.clear()
  diagnosticCountsByUri.clear()
  watchedFilePaths.clear()
  setRegisteredForMonaco(null)
  setActiveMonacoInstance(null)
  setActiveWorkspacePath(null)

  const currentConnection = connection
  setConnection(null)

  if (currentConnection) {
    try {
      await currentConnection.sendRequest('shutdown')
      currentConnection.sendNotification('exit')
    } catch {
      // Rust tarafinda process yine kapatilacak.
    }
    tryDispose(currentConnection)
  }

  tryDispose(reader)
  tryDispose(writer)
  setReader(null)
  setWriter(null)

  await invoke('lsp_stop')
  useIDEStore.getState().setLspIndexProgress(0, 0, 'Kotlin LSP is idle')
  useIDEStore.getState().clearDiagnostics()
  setLspStatus('stopped', 'Kotlin LSP stopped')
}

function bindMonacoInstance(monacoInstance: typeof monaco) {
  setActiveMonacoInstance(monacoInstance)
  registerMonacoProviders(monacoInstance)
  attachExistingModels(monacoInstance)
}

async function listenToLspEvents() {
  for (const unlisten of eventUnlisteners.splice(0)) unlisten()

  eventUnlisteners.push(
    await listen<string>('lsp://stderr', (event) => {
      console.debug('[LSP stderr]', event.payload)
    }),
  )

  eventUnlisteners.push(
    await listen('lsp://stopped', () => {
      if (DEBUG_LSP_LOGS) console.debug('[LSP] process stopped')
      setIsIndexingComplete(false)
      stopWatchingStoreFiles()
      tryDispose(connection)
      setConnection(null)
      openedUris.clear()
      attachedModelUris.clear()
      diagnosticEnabledUris.clear()
      diagnosticCountsByUri.clear()
      watchedFilePaths.clear()
      setActiveMonacoInstance(null)
      setActiveWorkspacePath(null)
      useIDEStore.getState().setLspIndexProgress(0, 0, 'Kotlin LSP process stopped')
      useIDEStore.getState().clearDiagnostics()
      setLspStatus('stopped', 'Kotlin LSP process stopped')
    }),
  )
}

function registerConnectionHandlers() {
  if (!connection) return

  connection.onNotification('$/progress', (params: any) => {
    if (params.value?.kind === 'end') {
      setIsIndexingComplete(true)
      if (DEBUG_LSP_LOGS) console.debug('[LSP] indexing complete via $/progress')
    }
  })

  connection.onNotification('window/logMessage', (params: any) => {
    const message = params.message ?? params
    if (isNoisyLspLog(message)) {
      console.debug('[LSP log]', message)
      return
    }
    if (params.type === 1 || params.type === 2) {
      console.warn('[LSP log]', message)
    } else if (DEBUG_LSP_LOGS) {
      console.debug('[LSP log]', message)
    }
  })

  connection.onNotification('window/showMessage', (params: any) => {
    if (params.type === 1 || params.type === 2) {
      console.warn('[LSP msg]', params.message ?? params)
    } else if (DEBUG_LSP_LOGS) {
      console.debug('[LSP msg]', params.message ?? params)
    }
  })

  connection.onNotification('textDocument/publishDiagnostics', (params: any) => {
    applyDiagnostics(params.uri, params.diagnostics ?? [])
  })

  connection.onRequest('workspace/configuration', (params: any) => {
    const count = Array.isArray(params?.items) ? params.items.length : 0
    return Array.from({ length: count }, () => ({}))
  })

  connection.onRequest('window/showMessageRequest', () => null)
  connection.onRequest('window/workDoneProgress/create', () => null)
  connection.onRequest('client/registerCapability', () => null)
  connection.onRequest('client/unregisterCapability', () => null)
  connection.onRequest('workspace/applyEdit', () => ({
    applied: false,
    failureReason: 'Aurora does not apply workspace edits yet.',
  }))
}

async function indexWorkspaceKotlinFiles(workspacePath: string) {
  const files = collectKotlinFiles(useIDEStore.getState().files)
  const total = files.length

  if (total === 0) {
    useIDEStore.getState().setLspIndexProgress(0, 0, 'Ready - no Kotlin files found')
    setLspStatus('ready', 'Ready - no Kotlin files found')
    setIsIndexingComplete(true)
    startWatchingStoreFiles()
    return
  }

  if (!connection || activeWorkspacePath !== workspacePath) return

  useIDEStore.getState().setLspIndexProgress(
    total,
    total,
    `Ready - Kotlin LSP warmed for ${total} Kotlin file${total === 1 ? '' : 's'}`,
  )
  setLspStatus('ready', `Ready - Kotlin LSP warmed for ${total} Kotlin file${total === 1 ? '' : 's'}`)
  setIsIndexingComplete(true)
  startWatchingStoreFiles()
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