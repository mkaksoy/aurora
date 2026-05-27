import * as monaco from 'monaco-editor'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { useIDEStore } from '@/store/ide-store'
import {
  connection,
  isIndexingComplete,
  openedUris,
  attachedModelUris,
  diagnosticEnabledUris,
  diagnosticCountsByUri,
  diagnosticRefreshTimers,
  modelDisposables,
  watchedFilePaths,
  DEBUG_LSP_LOGS,
  fileUriFromPath,
  languageFromPath,
  modelUri,
} from './state'
import {
  scheduleDocumentDiagnostics,
  requestDocumentDiagnostics,
  publishDiagnosticCounts,
} from './diagnostics'

export function openTextDocument(
  uri: string,
  text: string,
  languageId: string,
  version: number,
) {
  if (!connection || openedUris.has(uri)) return

  openedUris.add(uri)
  if (DEBUG_LSP_LOGS) console.debug('[LSP] didOpen', { uri, languageId })

  connection.sendNotification('textDocument/didOpen', {
    textDocument: { uri, languageId, version, text },
  })
}

export function attachExistingModels(monacoInstance: typeof monaco) {
  for (const model of monacoInstance.editor.getModels()) {
    attachModel(monacoInstance, model)
  }
}

export function attachModel(
  monacoInstance: typeof monaco,
  model: monaco.editor.ITextModel,
  options: { diagnostics?: boolean } = {},
) {
  if (!connection || model.getLanguageId() !== 'kotlin') return

  const uri = modelUri(model)
  const enableDiagnostics = options.diagnostics ?? true
  if (enableDiagnostics) diagnosticEnabledUris.add(uri)

  if (!openedUris.has(uri)) {
    openTextDocument(uri, model.getValue(), 'kotlin', model.getVersionId())
  } else {
    connection.sendNotification('textDocument/didChange', {
      textDocument: { uri, version: model.getVersionId() },
      contentChanges: [{ text: model.getValue() }],
    })
  }

  if (enableDiagnostics && isIndexingComplete) {
    void requestDocumentDiagnostics(model)
  }

  if (attachedModelUris.has(uri)) return
  attachedModelUris.add(uri)

  modelDisposables.push(
    model.onDidChangeContent(() => {
      connection?.sendNotification('textDocument/didChange', {
        textDocument: { uri, version: model.getVersionId() },
        contentChanges: [{ text: model.getValue() }],
      })
      scheduleDocumentDiagnostics(model)
    }),
  )

  modelDisposables.push(
    model.onWillDispose(() => {
      openedUris.delete(uri)
      attachedModelUris.delete(uri)
      diagnosticEnabledUris.delete(uri)
      diagnosticCountsByUri.delete(uri)
      useIDEStore.getState().setDiagnosticsForUri(uri, [])
      publishDiagnosticCounts()
      const timer = diagnosticRefreshTimers.get(uri)
      if (timer) clearTimeout(timer)
      diagnosticRefreshTimers.delete(uri)
      monacoInstance.editor.setModelMarkers(model, 'kotlin-lsp', [])
      connection?.sendNotification('textDocument/didClose', {
        textDocument: { uri },
      })
    }),
  )
}

export async function ensureDefinitionModel(
  monacoInstance: typeof monaco,
  uri: monaco.Uri,
) {
  if (uri.scheme !== 'file') return
  if (monacoInstance.editor.getModel(uri)) return

  const text = await readTextFile(uri.fsPath).catch(() => null)
  if (text === null) return

  monacoInstance.editor.createModel(text, languageFromPath(uri.fsPath), uri)
}

export function closeTextDocument(uri: string) {
  if (!connection || !openedUris.has(uri)) return

  openedUris.delete(uri)
  connection.sendNotification('textDocument/didClose', {
    textDocument: { uri },
  })
}

export async function onFileCreated(path: string, monacoInstance: typeof monaco | null) {
  if (!connection) return

  const uri = fileUriFromPath(path)

  if (monacoInstance) {
    const monacoUri = monacoInstance.Uri.parse(uri)
    const existingModel = monacoInstance.editor.getModel(monacoUri)
    if (existingModel) {
      attachModel(monacoInstance, existingModel)
      return
    }
  }

  const text = await readTextFile(path).catch(() => null)
  if (text === null) return

  if (!openedUris.has(uri)) {
    openTextDocument(uri, text, 'kotlin', 1)
    watchedFilePaths.add(path)
  }

  if (monacoInstance) {
    const monacoUri = monacoInstance.Uri.parse(uri)
    if (!monacoInstance.editor.getModel(monacoUri)) {
      monacoInstance.editor.createModel(text, 'kotlin', monacoUri)
    }
  }
}

export async function onFileModified(path: string, monacoInstance: typeof monaco | null) {
  if (!connection) return

  const uri = fileUriFromPath(path)

  if (monacoInstance) {
    const monacoUri = monacoInstance.Uri.parse(uri)
    if (monacoInstance.editor.getModel(monacoUri)) return
  }

  const text = await readTextFile(path).catch(() => null)
  if (text === null) return

  if (openedUris.has(uri)) {
    connection.sendNotification('textDocument/didChange', {
      textDocument: { uri, version: Date.now() },
      contentChanges: [{ text }],
    })
  } else {
    openTextDocument(uri, text, 'kotlin', 1)
    watchedFilePaths.add(path)
  }
}

export function onFileDeleted(path: string, monacoInstance: typeof monaco | null) {
  if (!connection) return

  const uri = fileUriFromPath(path)

  closeTextDocument(uri)
  watchedFilePaths.delete(path)

  diagnosticCountsByUri.delete(uri)
  publishDiagnosticCounts()
  useIDEStore.getState().setDiagnosticsForUri(uri, [])

  if (monacoInstance) {
    const monacoUri = monacoInstance.Uri.parse(uri)
    const model = monacoInstance.editor.getModel(monacoUri)
    if (model) {
      monacoInstance.editor.setModelMarkers(model, 'kotlin-lsp', [])
    }
  }
}