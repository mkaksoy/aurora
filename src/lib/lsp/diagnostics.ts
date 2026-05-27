import * as monaco from 'monaco-editor'
import { DiagnosticItem, useIDEStore } from '@/store/ide-store'
import {
  connection,
  isIndexingComplete,
  activeMonacoInstance,
  diagnosticCountsByUri,
  diagnosticEnabledUris,
  diagnosticRefreshTimers,
  fileNameFromPath,
  modelUri,
  pathFromFileUri,
} from './state'

export function countDiagnostics(diagnostics: any[]) {
  return diagnostics.reduce(
    (counts, diagnostic) => {
      if (diagnostic.severity === 1) counts.errors += 1
      else if (diagnostic.severity === 2) counts.warnings += 1
      else if (diagnostic.severity === 4) counts.hints += 1
      else counts.infos += 1
      return counts
    },
    { errors: 0, warnings: 0, infos: 0, hints: 0 },
  )
}

export function publishDiagnosticCounts() {
  const total = { errors: 0, warnings: 0, infos: 0, hints: 0 }

  for (const counts of diagnosticCountsByUri.values()) {
    total.errors += counts.errors
    total.warnings += counts.warnings
    total.infos += counts.infos
    total.hints += counts.hints
  }

  useIDEStore.getState().setDiagnosticCounts(total)
}

export function applyDiagnostics(uri: string, diagnostics: any[]) {
  diagnosticCountsByUri.set(uri, countDiagnostics(diagnostics))
  publishDiagnosticCounts()
  useIDEStore.getState().setDiagnosticsForUri(
    uri,
    diagnostics.map((diagnostic: any, index: number) =>
      toDiagnosticItem(uri, diagnostic, index),
    ),
  )

  const monacoInstance = activeMonacoInstance
  if (!monacoInstance) return

  const model = monacoInstance.editor.getModel(monacoInstance.Uri.parse(uri))
  if (!model) return
  if (!diagnosticEnabledUris.has(uri)) return

  monacoInstance.editor.setModelMarkers(
    model,
    'kotlin-lsp',
    diagnostics.map((diagnostic: any) => ({
      severity: diagnosticSeverity(monacoInstance, diagnostic.severity),
      message: diagnostic.message,
      startLineNumber: diagnostic.range.start.line + 1,
      startColumn: diagnostic.range.start.character + 1,
      endLineNumber: diagnostic.range.end.line + 1,
      endColumn: diagnostic.range.end.character + 1,
    })),
  )
}

export function scheduleDocumentDiagnostics(model: monaco.editor.ITextModel) {
  const uri = modelUri(model)
  const existingTimer = diagnosticRefreshTimers.get(uri)
  if (existingTimer) clearTimeout(existingTimer)

  diagnosticRefreshTimers.set(
    uri,
    setTimeout(() => {
      diagnosticRefreshTimers.delete(uri)
      void requestDocumentDiagnostics(model)
    }, 500),
  )
}

export async function requestDocumentDiagnostics(model: monaco.editor.ITextModel) {
  if (!connection || !isIndexingComplete || model.getLanguageId() !== 'kotlin') return

  const uri = modelUri(model)

  try {
    const report: any = await connection.sendRequest('textDocument/diagnostic', {
      textDocument: { uri },
      previousResultId: null,
    })

    if (!report || report.kind === 'unchanged') return
    applyDiagnostics(uri, report.items ?? [])
  } catch (error) {
    console.warn('[LSP] diagnostics error', { uri, error })
  }
}

export function clearUriDiagnostics(uri: string, monacoInstance: typeof monaco, model: monaco.editor.ITextModel) {
  diagnosticCountsByUri.delete(uri)
  useIDEStore.getState().setDiagnosticsForUri(uri, [])
  publishDiagnosticCounts()
  monacoInstance.editor.setModelMarkers(model, 'kotlin-lsp', [])
}

function toDiagnosticItem(uri: string, diagnostic: any, index: number): DiagnosticItem {
  const path = pathFromFileUri(uri)
  const line = diagnostic.range.start.line + 1
  const column = diagnostic.range.start.character + 1

  return {
    id: `${uri}:${line}:${column}:${index}`,
    uri,
    path,
    fileName: fileNameFromPath(path),
    message: diagnostic.message,
    severity: diagnosticSeverityName(diagnostic.severity),
    line,
    column,
  }
}

function diagnosticSeverityName(severity?: number): DiagnosticItem['severity'] {
  if (severity === 1) return 'error'
  if (severity === 2) return 'warning'
  if (severity === 4) return 'hint'
  return 'info'
}

function diagnosticSeverity(monacoInstance: typeof monaco, severity?: number) {
  if (severity === 1) return monacoInstance.MarkerSeverity.Error
  if (severity === 2) return monacoInstance.MarkerSeverity.Warning
  if (severity === 4) return monacoInstance.MarkerSeverity.Hint
  return monacoInstance.MarkerSeverity.Info
}