import * as monaco from 'monaco-editor'
import { MessageConnection } from 'vscode-jsonrpc/browser'
import { UnlistenFn } from '@tauri-apps/api/event'
import { useIDEStore } from '@/store/ide-store'
import { TauriMessageReader, TauriMessageWriter } from './transport'

export let connection: MessageConnection | null = null
export let starting: Promise<void> | null = null
export let reader: TauriMessageReader | null = null
export let writer: TauriMessageWriter | null = null
export let registeredForMonaco: typeof monaco | null = null
export let activeMonacoInstance: typeof monaco | null = null
export let activeWorkspacePath: string | null = null
export let stopping: Promise<void> | null = null
export let isIndexingComplete = false

export const openedUris = new Set<string>()
export const attachedModelUris = new Set<string>()
export const diagnosticEnabledUris = new Set<string>()
export const diagnosticCountsByUri = new Map<string, { errors: number; warnings: number; infos: number; hints: number }>()
export const diagnosticRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
export const providerDisposables: monaco.IDisposable[] = []
export const modelDisposables: monaco.IDisposable[] = []
export const eventUnlisteners: UnlistenFn[] = []
export const watchedFilePaths = new Set<string>()

export const DEBUG_LSP_LOGS = false

export function setConnection(value: MessageConnection | null) { connection = value }
export function setStarting(value: Promise<void> | null) { starting = value }
export function setReader(value: TauriMessageReader | null) { reader = value }
export function setWriter(value: TauriMessageWriter | null) { writer = value }
export function setRegisteredForMonaco(value: typeof monaco | null) { registeredForMonaco = value }
export function setActiveMonacoInstance(value: typeof monaco | null) { activeMonacoInstance = value }
export function setActiveWorkspacePath(value: string | null) { activeWorkspacePath = value }
export function setStopping(value: Promise<void> | null) { stopping = value }
export function setIsIndexingComplete(value: boolean) { isIndexingComplete = value }

export function setLspStatus(
  status: 'stopped' | 'starting' | 'ready' | 'error',
  message: string,
) {
  useIDEStore.getState().setLspStatus(status, message)
}

export function fileUriFromPath(path: string): string {
  let value = path.replace(/\\/g, '/')

  if (/^[A-Za-z]:\//.test(value)) {
    value = `/${value}`
  }

  const encoded = value
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/%3A/gi, ':'))
    .join('/')

  return `file://${encoded}`
}

export function pathFromFileUri(uri: string): string {
  const parsed = monaco.Uri.parse(uri)
  return parsed.fsPath
}

export function fileNameFromPath(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path
}

export function languageFromPath(path: string): string {
  const name = fileNameFromPath(path)
  if (name.endsWith('.kt') || name.endsWith('.kts')) return 'kotlin'
  if (name.endsWith('.java')) return 'java'
  if (name.endsWith('.xml')) return 'xml'
  if (name.endsWith('.gradle')) return 'groovy'
  return 'text'
}

export function isKotlinPath(path: string): boolean {
  const name = path.replace(/\\/g, '/').split('/').pop() ?? ''
  if (name.endsWith('.gradle.kts')) return false
  return name.endsWith('.kt') || name.endsWith('.kts')
}

export function isLspCanceled(error: unknown): boolean {
  const value = error as { name?: string; message?: string }
  const text = String(value?.message ?? value ?? '')
  return value?.name === 'Canceled' || text === 'Canceled' || text.includes('Canceled: Canceled')
}

export function isConnectionDisposedError(error: unknown): boolean {
  const text = String((error as { message?: string })?.message ?? error ?? '')
  return (
    text.includes('connection got disposed') ||
    text.includes('Connection got disposed') ||
    text.includes('Pending response rejected')
  )
}

export function tryDispose(disposable: { dispose: () => void } | null | undefined) {
  try {
    disposable?.dispose()
  } catch (error) {
    if (!isConnectionDisposedError(error)) throw error
  }
}

export function modelUri(model: monaco.editor.ITextModel): string {
  if (model.uri.scheme !== 'file') return model.uri.toString(true)
  const path = model.uri.path || model.uri.fsPath
  return fileUriFromPath(path)
}

export function toLspPosition(position: monaco.Position) {
  return {
    line: position.lineNumber - 1,
    character: position.column - 1,
  }
}

export function toMonacoRange(monacoInstance: typeof monaco, range: any) {
  return new monacoInstance.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1,
  )
}

export function isNoisyLspLog(message: unknown): boolean {
  if (typeof message !== 'string') return false

  if (
    message.includes('SingleRootFileViewProvider') &&
    message.includes('file not found') &&
    (message.includes('build.gradle.kts') || message.includes('settings.gradle.kts'))
  ) {
    return true
  }

  return (
    message.includes('SingleRootFileViewProvider') &&
    message.includes('content metadata not found')
  )
}

export function clientCapabilities() {
  return {
    workspace: {
      applyEdit: true,
      workspaceEdit: { documentChanges: true },
      didChangeConfiguration: { dynamicRegistration: true },
      configuration: true,
      workspaceFolders: true,
    },
    textDocument: {
      synchronization: {
        dynamicRegistration: true,
        willSave: false,
        didSave: true,
        willSaveWaitUntil: false,
      },
      completion: {
        dynamicRegistration: true,
        contextSupport: true,
        completionItem: {
          snippetSupport: true,
          documentationFormat: ['markdown', 'plaintext'],
          deprecatedSupport: true,
          preselectSupport: true,
          resolveSupport: {
            properties: ['documentation', 'detail', 'additionalTextEdits'],
          },
        },
      },
      hover: {
        dynamicRegistration: true,
        contentFormat: ['markdown', 'plaintext'],
      },
      definition: { dynamicRegistration: true, linkSupport: true },
      references: { dynamicRegistration: true },
      documentHighlight: { dynamicRegistration: true },
      publishDiagnostics: {
        relatedInformation: true,
        versionSupport: true,
        codeDescriptionSupport: true,
        dataSupport: true,
      },
      diagnostic: {
        dynamicRegistration: true,
        relatedDocumentSupport: true,
      },
    },
    window: {
      showMessage: { messageActionItem: { additionalPropertiesSupport: true } },
      workDoneProgress: true,
    },
    general: {
      positionEncodings: ['utf-16'],
    },
  }
}