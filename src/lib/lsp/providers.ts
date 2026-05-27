import * as monaco from 'monaco-editor'
import {
  connection,
  isIndexingComplete,
  registeredForMonaco,
  providerDisposables,
  DEBUG_LSP_LOGS,
  modelUri,
  toLspPosition,
  toMonacoRange,
  isLspCanceled,
  setRegisteredForMonaco,
} from './state'
import { attachModel, ensureDefinitionModel } from './documents'

export function registerMonacoProviders(monacoInstance: typeof monaco) {
  if (registeredForMonaco === monacoInstance) return
  setRegisteredForMonaco(monacoInstance)

  providerDisposables.push(
    monacoInstance.languages.registerCompletionItemProvider('kotlin', {
      triggerCharacters: ['.', '(', ':', '"'],
      provideCompletionItems: async (model, position) => {
        if (!connection || !isIndexingComplete) return { suggestions: [] }

        try {
          const result: any = await connection.sendRequest('textDocument/completion', {
            textDocument: { uri: modelUri(model) },
            position: toLspPosition(position),
          })
          const items = Array.isArray(result) ? result : result?.items ?? []
          if (DEBUG_LSP_LOGS) {
            console.debug('[LSP] completion', { uri: modelUri(model), items: items.length })
          }

          return {
            suggestions: items.map((item: any) => ({
              label: item.label,
              kind: completionKind(monacoInstance, item.kind),
              detail: item.detail,
              documentation: markdownString(item.documentation),
              insertText: item.insertText ?? item.label,
              insertTextRules:
                item.insertTextFormat === 2
                  ? monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet
                  : undefined,
              range: completionRange(model, position),
              sortText: item.sortText,
              filterText: item.filterText,
            })),
          }
        } catch (error) {
          console.error('[LSP] completion error', error)
          return { suggestions: [] }
        }
      },
    }),
  )

  providerDisposables.push(
    monacoInstance.languages.registerHoverProvider('kotlin', {
      provideHover: async (model, position) => {
        if (!connection || !isIndexingComplete) return null

        try {
          const result: any = await connection.sendRequest('textDocument/hover', {
            textDocument: { uri: modelUri(model) },
            position: toLspPosition(position),
          })
          if (DEBUG_LSP_LOGS) {
            console.debug('[LSP] hover', { uri: modelUri(model), hasResult: Boolean(result) })
          }
          if (!result?.contents) return null

          return {
            contents: hoverContents(result.contents),
            range: result.range ? toMonacoRange(monacoInstance, result.range) : undefined,
          }
        } catch (error) {
          if (!isLspCanceled(error)) {
            console.warn('[LSP] hover error', error)
          }
          return null
        }
      },
    }),
  )

  providerDisposables.push(
    monacoInstance.languages.registerDefinitionProvider('kotlin', {
      provideDefinition: async (model, position) => {
        if (!connection || !isIndexingComplete) return null

        try {
          const result: any = await connection.sendRequest('textDocument/definition', {
            textDocument: { uri: modelUri(model) },
            position: toLspPosition(position),
          })
          if (!result) return null

          const locations = Array.isArray(result) ? result : [result]
          const definitions = await Promise.all(
            locations.map(async (location: any) => {
              const uri = monacoInstance.Uri.parse(location.targetUri ?? location.uri)
              await ensureDefinitionModel(monacoInstance, uri)

              return {
                uri,
                range: toMonacoRange(monacoInstance, location.targetRange ?? location.range),
              }
            }),
          )

          return definitions
        } catch (error) {
          if (!isLspCanceled(error)) {
            console.warn('[LSP] definition error', error)
          }
          return null
        }
      },
    }),
  )

  providerDisposables.push(
    monacoInstance.editor.onDidCreateModel((model) => attachModel(monacoInstance, model)),
  )
}

function completionRange(model: monaco.editor.ITextModel, position: monaco.Position) {
  const word = model.getWordUntilPosition(position)
  return {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn,
  }
}

function completionKind(monacoInstance: typeof monaco, kind?: number) {
  const map: Record<number, monaco.languages.CompletionItemKind> = {
    2: monacoInstance.languages.CompletionItemKind.Method,
    3: monacoInstance.languages.CompletionItemKind.Function,
    4: monacoInstance.languages.CompletionItemKind.Constructor,
    5: monacoInstance.languages.CompletionItemKind.Field,
    6: monacoInstance.languages.CompletionItemKind.Variable,
    7: monacoInstance.languages.CompletionItemKind.Class,
    8: monacoInstance.languages.CompletionItemKind.Interface,
    9: monacoInstance.languages.CompletionItemKind.Module,
    10: monacoInstance.languages.CompletionItemKind.Property,
    12: monacoInstance.languages.CompletionItemKind.Value,
    13: monacoInstance.languages.CompletionItemKind.Enum,
    14: monacoInstance.languages.CompletionItemKind.Keyword,
    15: monacoInstance.languages.CompletionItemKind.Snippet,
    16: monacoInstance.languages.CompletionItemKind.Color,
    17: monacoInstance.languages.CompletionItemKind.File,
    18: monacoInstance.languages.CompletionItemKind.Reference,
    21: monacoInstance.languages.CompletionItemKind.Constant,
    22: monacoInstance.languages.CompletionItemKind.Struct,
    23: monacoInstance.languages.CompletionItemKind.Event,
    24: monacoInstance.languages.CompletionItemKind.Operator,
    25: monacoInstance.languages.CompletionItemKind.TypeParameter,
  }

  return map[kind ?? 1] ?? monacoInstance.languages.CompletionItemKind.Text
}

function markdownString(value: any) {
  if (!value) return undefined
  if (typeof value === 'string') return value
  return value.value ?? undefined
}

function hoverContents(contents: any): monaco.IMarkdownString[] {
  const values = Array.isArray(contents) ? contents : [contents]
  return values.map((item) => ({
    value: typeof item === 'string' ? item : item.value ?? '',
  }))
}