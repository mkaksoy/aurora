import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { readTextFile } from "@tauri-apps/plugin-fs";
import * as monaco from "monaco-editor";
import { createMessageConnection, MessageConnection } from "vscode-jsonrpc/browser";
import { DiagnosticItem, FileNode, useIDEStore } from "@/store/ide-store";
import { TauriMessageReader, TauriMessageWriter } from "./lspTransport";

let connection: MessageConnection | null = null;
let starting: Promise<void> | null = null;
let reader: TauriMessageReader | null = null;
let writer: TauriMessageWriter | null = null;
let registeredForMonaco: typeof monaco | null = null;
let activeMonacoInstance: typeof monaco | null = null;
let activeWorkspacePath: string | null = null;
let stopping: Promise<void> | null = null;

const openedUris = new Set<string>();
const attachedModelUris = new Set<string>();
const diagnosticEnabledUris = new Set<string>();
const diagnosticCountsByUri = new Map<string, { errors: number; warnings: number; infos: number; hints: number }>();
const diagnosticRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
const providerDisposables: monaco.IDisposable[] = [];
const modelDisposables: monaco.IDisposable[] = [];
const eventUnlisteners: UnlistenFn[] = [];

const DEBUG_LSP_LOGS = false;

export async function startKotlinLsp(
  workspacePath: string,
  monacoInstance?: typeof monaco,
): Promise<void> {
  if (monacoInstance) {
    activeMonacoInstance = monacoInstance;
  }

  if (connection) {
    if (activeWorkspacePath !== workspacePath) {
      await stopKotlinLsp();
    } else {
      if (monacoInstance) bindMonacoInstance(monacoInstance);
      return;
    }
  }

  if (starting) {
    return starting.then(() => {
      if (monacoInstance) bindMonacoInstance(monacoInstance);
    });
  }

  starting = startKotlinLspInner(workspacePath, monacoInstance)
    .catch((error) => {
      if (isConnectionDisposedError(error)) {
        setLspStatus("stopped", "Kotlin LSP stopped");
        return;
      }

      setLspStatus("error", String(error));
      throw error;
    })
    .finally(() => {
      starting = null;
    });

  return starting;
}

async function startKotlinLspInner(
  workspacePath: string,
  monacoInstance?: typeof monaco,
): Promise<void> {
  setLspStatus("starting", "Starting Kotlin LSP process");
  activeWorkspacePath = workspacePath;
  if (DEBUG_LSP_LOGS) console.debug("[LSP] starting", { workspacePath });

  const workspaceUri = await invoke<string>("lsp_file_uri", { path: workspacePath });

  reader = new TauriMessageReader();
  writer = new TauriMessageWriter();
  await reader.start();
  await listenToLspEvents();

  try {
    const startResult = await invoke("lsp_start", {
      options: {
        workspacePath,
      },
    });
    if (DEBUG_LSP_LOGS) console.debug("[LSP] process started", startResult);
  } catch (error) {
    if (!String(error).includes("already running")) throw error;

    console.warn("[LSP] stale process detected, restarting");
    await invoke("lsp_stop");
    const startResult = await invoke("lsp_start", {
      options: {
        workspacePath,
      },
    });
    if (DEBUG_LSP_LOGS) console.debug("[LSP] process restarted", startResult);
  }

  connection = createMessageConnection(reader, writer);
  registerConnectionHandlers();
  connection.listen();

  const workspaceName =
    workspacePath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ??
    "workspace";

  const initializeResult = await connection.sendRequest("initialize", {
    processId: null,
    clientInfo: { name: "Aurora", version: "0.1.0" },
    locale: "tr",
    rootUri: workspaceUri,
    workspaceFolders: [{ uri: workspaceUri, name: workspaceName }],
    capabilities: clientCapabilities(),
    initializationOptions: {},
  });

  connection.sendNotification("initialized", {});
  if (DEBUG_LSP_LOGS) console.debug("[LSP] initialized", initializeResult);
  setLspStatus("ready", "Kotlin LSP initialized");

  if (monacoInstance) bindMonacoInstance(monacoInstance);
  await indexWorkspaceKotlinFiles(workspacePath);
}

export async function stopKotlinLsp(): Promise<void> {
  if (stopping) return stopping;

  stopping = stopKotlinLspInner().finally(() => {
    stopping = null;
  });

  return stopping;
}

async function stopKotlinLspInner(): Promise<void> {
  for (const disposable of providerDisposables.splice(0)) {
    tryDispose(disposable);
  }
  for (const disposable of modelDisposables.splice(0)) {
    tryDispose(disposable);
  }
  for (const unlisten of eventUnlisteners.splice(0)) {
    unlisten();
  }
  for (const timer of diagnosticRefreshTimers.values()) {
    clearTimeout(timer);
  }
  diagnosticRefreshTimers.clear();
  openedUris.clear();
  attachedModelUris.clear();
  diagnosticEnabledUris.clear();
  diagnosticCountsByUri.clear();
  registeredForMonaco = null;
  activeMonacoInstance = null;
  activeWorkspacePath = null;

  const currentConnection = connection;
  connection = null;

  if (currentConnection) {
    try {
      await currentConnection.sendRequest("shutdown");
      currentConnection.sendNotification("exit");
    } catch {
      // Rust tarafinda process yine kapatilacak.
    }
    tryDispose(currentConnection);
  }

  tryDispose(reader);
  tryDispose(writer);
  reader = null;
  writer = null;

  await invoke("lsp_stop");
  useIDEStore.getState().setLspIndexProgress(0, 0, "Kotlin LSP is idle");
  useIDEStore.getState().clearDiagnostics();
  setLspStatus("stopped", "Kotlin LSP stopped");
}

export function notifyDocumentSaved(path: string, text: string): void {
  if (!connection) return;

  connection.sendNotification("textDocument/didSave", {
    textDocument: { uri: fileUriFromPath(path) },
    text,
  });
}

async function listenToLspEvents() {
  for (const unlisten of eventUnlisteners.splice(0)) {
    unlisten();
  }

  eventUnlisteners.push(
    await listen<string>("lsp://stderr", (event) => {
      console.debug("[LSP stderr]", event.payload);
    }),
  );

  eventUnlisteners.push(
    await listen("lsp://stopped", () => {
      if (DEBUG_LSP_LOGS) console.debug("[LSP] process stopped");
      tryDispose(connection);
      connection = null;
      openedUris.clear();
      attachedModelUris.clear();
      diagnosticEnabledUris.clear();
      diagnosticCountsByUri.clear();
      activeMonacoInstance = null;
      activeWorkspacePath = null;
      useIDEStore.getState().setLspIndexProgress(0, 0, "Kotlin LSP process stopped");
      useIDEStore.getState().clearDiagnostics();
      setLspStatus("stopped", "Kotlin LSP process stopped");
    }),
  );
}

function tryDispose(disposable: { dispose: () => void } | null | undefined) {
  try {
    disposable?.dispose();
  } catch (error) {
    if (!isConnectionDisposedError(error)) throw error;
  }
}

function registerConnectionHandlers() {
  if (!connection) return;

  connection.onNotification("window/logMessage", (params: any) => {
    const message = params.message ?? params;
    if (isNoisyLspLog(message)) {
      console.debug("[LSP log]", message);
      return;
    }

    if (params.type === 1 || params.type === 2) {
      console.warn("[LSP log]", message);
    } else if (DEBUG_LSP_LOGS) {
      console.debug("[LSP log]", message);
    }
  });

  connection.onNotification("window/showMessage", (params: any) => {
    if (params.type === 1 || params.type === 2) {
      console.warn("[LSP msg]", params.message ?? params);
    } else if (DEBUG_LSP_LOGS) {
      console.debug("[LSP msg]", params.message ?? params);
    }
  });

  connection.onNotification("textDocument/publishDiagnostics", (params: any) => {
    const diagnostics = params.diagnostics ?? [];
    applyDiagnostics(params.uri, diagnostics);
  });

  connection.onRequest("workspace/configuration", (params: any) => {
    const count = Array.isArray(params?.items) ? params.items.length : 0;
    return Array.from({ length: count }, () => ({}));
  });

  connection.onRequest("window/showMessageRequest", () => null);
  connection.onRequest("window/workDoneProgress/create", () => null);
  connection.onRequest("client/registerCapability", () => null);
  connection.onRequest("client/unregisterCapability", () => null);
  connection.onRequest("workspace/applyEdit", () => ({
    applied: false,
    failureReason: "Aurora does not apply workspace edits yet.",
  }));
}

function bindMonacoInstance(monacoInstance: typeof monaco) {
  activeMonacoInstance = monacoInstance;
  registerMonacoProviders(monacoInstance);
  attachExistingModels(monacoInstance);
}

function registerMonacoProviders(monacoInstance: typeof monaco) {
  if (registeredForMonaco === monacoInstance) return;
  registeredForMonaco = monacoInstance;

  providerDisposables.push(
    monacoInstance.languages.registerCompletionItemProvider("kotlin", {
      triggerCharacters: [".", "(", ":", '"'],
      provideCompletionItems: async (model, position) => {
        if (!connection) return { suggestions: [] };

        try {
          const result: any = await connection.sendRequest("textDocument/completion", {
            textDocument: { uri: modelUri(model) },
            position: toLspPosition(position),
          });
          const items = Array.isArray(result) ? result : result?.items ?? [];
          if (DEBUG_LSP_LOGS) {
            console.debug("[LSP] completion", { uri: modelUri(model), items: items.length });
          }

          return {
            suggestions: items.map((item: any) => ({
              label: item.label,
              kind: completionKind(monacoInstance, item.kind),
              detail: item.detail,
              documentation: markdownString(item.documentation),
              insertText: item.insertText ?? item.label,
              insertTextRules: item.insertTextFormat === 2
                ? monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : undefined,
              range: completionRange(model, position),
              sortText: item.sortText,
              filterText: item.filterText,
            })),
          };
        } catch (error) {
          console.error("[LSP] completion error", error);
          return { suggestions: [] };
        }
      },
    }),
  );

  providerDisposables.push(
    monacoInstance.languages.registerHoverProvider("kotlin", {
      provideHover: async (model, position) => {
        if (!connection) return null;

        try {
          const result: any = await connection.sendRequest("textDocument/hover", {
            textDocument: { uri: modelUri(model) },
            position: toLspPosition(position),
          });
          if (DEBUG_LSP_LOGS) {
            console.debug("[LSP] hover", { uri: modelUri(model), hasResult: Boolean(result) });
          }
          if (!result?.contents) return null;

          return {
            contents: hoverContents(result.contents),
            range: result.range ? toMonacoRange(monacoInstance, result.range) : undefined,
          };
        } catch (error) {
          if (!isLspCanceled(error)) {
            console.warn("[LSP] hover error", error);
          }
          return null;
        }
      },
    }),
  );

  providerDisposables.push(
    monacoInstance.languages.registerDefinitionProvider("kotlin", {
      provideDefinition: async (model, position) => {
        if (!connection) return null;

        try {
          const result: any = await connection.sendRequest("textDocument/definition", {
            textDocument: { uri: modelUri(model) },
            position: toLspPosition(position),
          });
          if (!result) return null;

          const locations = Array.isArray(result) ? result : [result];
          const definitions = await Promise.all(
            locations.map(async (location: any) => {
              const uri = monacoInstance.Uri.parse(location.targetUri ?? location.uri);
              await ensureDefinitionModel(monacoInstance, uri);

              return {
                uri,
                range: toMonacoRange(monacoInstance, location.targetRange ?? location.range),
              };
            }),
          );

          return definitions;
        } catch (error) {
          if (!isLspCanceled(error)) {
            console.warn("[LSP] definition error", error);
          }
          return null;
        }
      },
    }),
  );

  providerDisposables.push(
    monacoInstance.editor.onDidCreateModel((model) => attachModel(monacoInstance, model)),
  );
}

async function indexWorkspaceKotlinFiles(workspacePath: string) {
  const files = collectKotlinFiles(useIDEStore.getState().files);
  const total = files.length;

  if (total === 0) {
    useIDEStore.getState().setLspIndexProgress(0, 0, "Ready - no Kotlin files found");
    setLspStatus("ready", "Ready - no Kotlin files found");
    return;
  }

  if (!connection || activeWorkspacePath !== workspacePath) return;

  useIDEStore.getState().setLspIndexProgress(
    total,
    total,
    `Ready - Kotlin LSP warmed for ${total} Kotlin file${total === 1 ? "" : "s"}`,
  );
  setLspStatus("ready", `Ready - Kotlin LSP warmed for ${total} Kotlin file${total === 1 ? "" : "s"}`);
}

function collectKotlinFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = [];

  for (const node of nodes) {
    if (node.type === "folder") {
      files.push(...collectKotlinFiles(node.children ?? []));
    } else if (isIndexableKotlinFile(node)) {
      files.push(node);
    }
  }

  return files;
}

function isIndexableKotlinFile(node: FileNode) {
  if (node.name.endsWith(".gradle.kts")) return false;
  return node.language === "kotlin" || node.name.endsWith(".kt") || node.name.endsWith(".kts");
}

function countDiagnostics(diagnostics: any[]) {
  return diagnostics.reduce(
    (counts, diagnostic) => {
      if (diagnostic.severity === 1) counts.errors += 1;
      else if (diagnostic.severity === 2) counts.warnings += 1;
      else if (diagnostic.severity === 4) counts.hints += 1;
      else counts.infos += 1;

      return counts;
    },
    { errors: 0, warnings: 0, infos: 0, hints: 0 },
  );
}

function publishDiagnosticCounts() {
  const total = { errors: 0, warnings: 0, infos: 0, hints: 0 };

  for (const counts of diagnosticCountsByUri.values()) {
    total.errors += counts.errors;
    total.warnings += counts.warnings;
    total.infos += counts.infos;
    total.hints += counts.hints;
  }

  useIDEStore.getState().setDiagnosticCounts(total);
}

function applyDiagnostics(
  uri: string,
  diagnostics: any[],
) {
  diagnosticCountsByUri.set(uri, countDiagnostics(diagnostics));
  publishDiagnosticCounts();
  useIDEStore.getState().setDiagnosticsForUri(
    uri,
    diagnostics.map((diagnostic: any, index: number) =>
      toDiagnosticItem(uri, diagnostic, index),
    ),
  );

  const monacoInstance = activeMonacoInstance;
  if (!monacoInstance) return;

  const model = monacoInstance.editor.getModel(monacoInstance.Uri.parse(uri));
  if (!model) return;
  if (!diagnosticEnabledUris.has(uri)) return;

  monacoInstance.editor.setModelMarkers(
    model,
    "kotlin-lsp",
    diagnostics.map((diagnostic: any) => ({
      severity: diagnosticSeverity(monacoInstance, diagnostic.severity),
      message: diagnostic.message,
      startLineNumber: diagnostic.range.start.line + 1,
      startColumn: diagnostic.range.start.character + 1,
      endLineNumber: diagnostic.range.end.line + 1,
      endColumn: diagnostic.range.end.character + 1,
    })),
  );
}

function scheduleDocumentDiagnostics(model: monaco.editor.ITextModel) {
  const uri = modelUri(model);
  const existingTimer = diagnosticRefreshTimers.get(uri);
  if (existingTimer) clearTimeout(existingTimer);

  diagnosticRefreshTimers.set(
    uri,
    setTimeout(() => {
      diagnosticRefreshTimers.delete(uri);
      void requestDocumentDiagnostics(model);
    }, 500),
  );
}

async function requestDocumentDiagnostics(model: monaco.editor.ITextModel) {
  if (!connection || model.getLanguageId() !== "kotlin") return;

  const uri = modelUri(model);

  try {
    const report: any = await connection.sendRequest("textDocument/diagnostic", {
      textDocument: { uri },
      previousResultId: null,
    });

    if (!report || report.kind === "unchanged") return;
    applyDiagnostics(uri, report.items ?? []);
  } catch (error) {
    console.warn("[LSP] diagnostics error", { uri, error });
  }
}

function attachExistingModels(monacoInstance: typeof monaco) {
  for (const model of monacoInstance.editor.getModels()) {
    attachModel(monacoInstance, model);
  }
}

function attachModel(
  monacoInstance: typeof monaco,
  model: monaco.editor.ITextModel,
  options: { diagnostics?: boolean } = {},
) {
  if (!connection || model.getLanguageId() !== "kotlin") return;

  const uri = modelUri(model);
  const enableDiagnostics = options.diagnostics ?? true;
  if (enableDiagnostics) diagnosticEnabledUris.add(uri);

  if (!openedUris.has(uri)) {
    openTextDocument(uri, model.getValue(), "kotlin", model.getVersionId());
  } else {
    connection.sendNotification("textDocument/didChange", {
      textDocument: { uri, version: model.getVersionId() },
      contentChanges: [{ text: model.getValue() }],
    });
  }

  if (enableDiagnostics) {
    void requestDocumentDiagnostics(model);
  }

  if (attachedModelUris.has(uri)) return;
  attachedModelUris.add(uri);

  modelDisposables.push(
    model.onDidChangeContent(() => {
      connection?.sendNotification("textDocument/didChange", {
        textDocument: { uri, version: model.getVersionId() },
        contentChanges: [{ text: model.getValue() }],
      });
      scheduleDocumentDiagnostics(model);
    }),
  );

  modelDisposables.push(
    model.onWillDispose(() => {
      openedUris.delete(uri);
      attachedModelUris.delete(uri);
      diagnosticEnabledUris.delete(uri);
      diagnosticCountsByUri.delete(uri);
      useIDEStore.getState().setDiagnosticsForUri(uri, []);
      publishDiagnosticCounts();
      const timer = diagnosticRefreshTimers.get(uri);
      if (timer) clearTimeout(timer);
      diagnosticRefreshTimers.delete(uri);
      monacoInstance.editor.setModelMarkers(model, "kotlin-lsp", []);
      connection?.sendNotification("textDocument/didClose", {
        textDocument: { uri },
      });
    }),
  );
}

function openTextDocument(
  uri: string,
  text: string,
  languageId: string,
  version: number,
) {
  if (!connection || openedUris.has(uri)) return;

  openedUris.add(uri);
  if (DEBUG_LSP_LOGS) console.debug("[LSP] didOpen", { uri, languageId });

  connection.sendNotification("textDocument/didOpen", {
    textDocument: {
      uri,
      languageId,
      version,
      text,
    },
  });
}

async function ensureDefinitionModel(
  monacoInstance: typeof monaco,
  uri: monaco.Uri,
) {
  if (uri.scheme !== "file") return;
  if (monacoInstance.editor.getModel(uri)) return;

  const text = await readTextFile(uri.fsPath).catch(() => null);
  if (text === null) return;

  monacoInstance.editor.createModel(text, languageFromPath(uri.fsPath), uri);
}

function setLspStatus(
  status: "stopped" | "starting" | "ready" | "error",
  message: string,
) {
  useIDEStore.getState().setLspStatus(status, message);
}

function modelUri(model: monaco.editor.ITextModel) {
  if (model.uri.scheme !== "file") return model.uri.toString(true);

  const path = model.uri.path || model.uri.fsPath;
  return fileUriFromPath(path);
}

export function fileUriFromPath(path: string) {
  let value = path.replace(/\\/g, "/");

  if (/^[A-Za-z]:\//.test(value)) {
    value = `/${value}`;
  }

  const encoded = value
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/%3A/gi, ":"))
    .join("/");

  return `file://${encoded}`;
}

function pathFromFileUri(uri: string) {
  const parsed = monaco.Uri.parse(uri);
  return parsed.fsPath;
}

function fileNameFromPath(path: string) {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

function languageFromPath(path: string) {
  const name = fileNameFromPath(path);

  if (name.endsWith(".kt") || name.endsWith(".kts")) return "kotlin";
  if (name.endsWith(".java")) return "java";
  if (name.endsWith(".xml")) return "xml";
  if (name.endsWith(".gradle")) return "groovy";
  return "text";
}

function diagnosticSeverityName(severity?: number): DiagnosticItem["severity"] {
  if (severity === 1) return "error";
  if (severity === 2) return "warning";
  if (severity === 4) return "hint";
  return "info";
}

function toDiagnosticItem(uri: string, diagnostic: any, index: number): DiagnosticItem {
  const path = pathFromFileUri(uri);
  const line = diagnostic.range.start.line + 1;
  const column = diagnostic.range.start.character + 1;

  return {
    id: `${uri}:${line}:${column}:${index}`,
    uri,
    path,
    fileName: fileNameFromPath(path),
    message: diagnostic.message,
    severity: diagnosticSeverityName(diagnostic.severity),
    line,
    column,
  };
}

function isNoisyLspLog(message: unknown) {
  if (typeof message !== "string") return false;

  if (
    message.includes("SingleRootFileViewProvider") &&
    message.includes("file not found") &&
    (message.includes("build.gradle.kts") || message.includes("settings.gradle.kts"))
  ) {
    return true;
  }

  return (
    message.includes("SingleRootFileViewProvider") &&
    message.includes("content metadata not found")
  );
}

function clientCapabilities() {
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
          documentationFormat: ["markdown", "plaintext"],
          deprecatedSupport: true,
          preselectSupport: true,
          resolveSupport: {
            properties: ["documentation", "detail", "additionalTextEdits"],
          },
        },
      },
      hover: {
        dynamicRegistration: true,
        contentFormat: ["markdown", "plaintext"],
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
      positionEncodings: ["utf-16"],
    },
  };
}

function toLspPosition(position: monaco.Position) {
  return {
    line: position.lineNumber - 1,
    character: position.column - 1,
  };
}

function toMonacoRange(monacoInstance: typeof monaco, range: any) {
  return new monacoInstance.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1,
  );
}

function completionRange(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
) {
  const word = model.getWordUntilPosition(position);
  return {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn,
  };
}

function diagnosticSeverity(monacoInstance: typeof monaco, severity?: number) {
  if (severity === 1) return monacoInstance.MarkerSeverity.Error;
  if (severity === 2) return monacoInstance.MarkerSeverity.Warning;
  if (severity === 4) return monacoInstance.MarkerSeverity.Hint;
  return monacoInstance.MarkerSeverity.Info;
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
  };

  return map[kind ?? 1] ?? monacoInstance.languages.CompletionItemKind.Text;
}

function markdownString(value: any) {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  return value.value ?? undefined;
}

function hoverContents(contents: any): monaco.IMarkdownString[] {
  const values = Array.isArray(contents) ? contents : [contents];

  return values.map((item) => ({
    value: typeof item === "string" ? item : item.value ?? "",
  }));
}

function isLspCanceled(error: unknown) {
  const value = error as { name?: string; message?: string };
  const text = String(value?.message ?? value ?? "");

  return value?.name === "Canceled" || text === "Canceled" || text.includes("Canceled: Canceled");
}

function isConnectionDisposedError(error: unknown) {
  const text = String((error as { message?: string })?.message ?? error ?? "");

  return (
    text.includes("connection got disposed") ||
    text.includes("Connection got disposed") ||
    text.includes("Pending response rejected")
  );
}
