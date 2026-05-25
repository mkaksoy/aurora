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
let activeWorkspacePath: string | null = null;

const openedUris = new Set<string>();
const diagnosticCountsByUri = new Map<string, { errors: number; warnings: number; infos: number; hints: number }>();
const diagnosticRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
const providerDisposables: monaco.IDisposable[] = [];
const modelDisposables: monaco.IDisposable[] = [];
const eventUnlisteners: UnlistenFn[] = [];

export async function startKotlinLsp(
  workspacePath: string,
  monacoInstance: typeof monaco,
): Promise<void> {
  if (connection) {
    if (activeWorkspacePath !== workspacePath) {
      await stopKotlinLsp();
    } else {
      registerMonacoProviders(monacoInstance);
      attachExistingModels(monacoInstance);
      return;
    }
  }

  if (starting) return starting;

  starting = startKotlinLspInner(workspacePath, monacoInstance)
    .catch((error) => {
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
  monacoInstance: typeof monaco,
): Promise<void> {
  setLspStatus("starting", "Starting Kotlin LSP process");
  activeWorkspacePath = workspacePath;
  console.log("[LSP] starting", { workspacePath });

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
    console.log("[LSP] process started", startResult);
  } catch (error) {
    if (!String(error).includes("already running")) throw error;

    console.warn("[LSP] stale process detected, restarting");
    await invoke("lsp_stop");
    const startResult = await invoke("lsp_start", {
      options: {
        workspacePath,
      },
    });
    console.log("[LSP] process restarted", startResult);
  }

  connection = createMessageConnection(reader, writer);
  registerConnectionHandlers(monacoInstance);
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
  console.log("[LSP] initialized", initializeResult);
  setLspStatus("ready", "Kotlin LSP initialized");

  registerMonacoProviders(monacoInstance);
  attachExistingModels(monacoInstance);
  await indexWorkspaceKotlinFiles(monacoInstance, workspacePath);
}

export async function stopKotlinLsp(): Promise<void> {
  for (const disposable of providerDisposables.splice(0)) {
    disposable.dispose();
  }
  for (const disposable of modelDisposables.splice(0)) {
    disposable.dispose();
  }
  for (const unlisten of eventUnlisteners.splice(0)) {
    unlisten();
  }
  for (const timer of diagnosticRefreshTimers.values()) {
    clearTimeout(timer);
  }
  diagnosticRefreshTimers.clear();
  openedUris.clear();
  diagnosticCountsByUri.clear();
  registeredForMonaco = null;
  activeWorkspacePath = null;

  if (connection) {
    try {
      await connection.sendRequest("shutdown");
      connection.sendNotification("exit");
    } catch {
      // Rust tarafinda process yine kapatilacak.
    }
    connection.dispose();
    connection = null;
  }

  reader?.dispose();
  writer?.dispose();
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
      console.warn("[LSP] process stopped");
      connection?.dispose();
      connection = null;
      openedUris.clear();
      diagnosticCountsByUri.clear();
      activeWorkspacePath = null;
      useIDEStore.getState().setLspIndexProgress(0, 0, "Kotlin LSP process stopped");
      useIDEStore.getState().clearDiagnostics();
      setLspStatus("stopped", "Kotlin LSP process stopped");
    }),
  );
}

function registerConnectionHandlers(monacoInstance: typeof monaco) {
  if (!connection) return;

  connection.onNotification("window/logMessage", (params: any) => {
    const message = params.message ?? params;
    if (isNoisyMissingGradleScriptLog(message)) {
      console.debug("[LSP log]", message);
      return;
    }

    console.log("[LSP log]", message);
  });

  connection.onNotification("window/showMessage", (params: any) => {
    console.log("[LSP msg]", params.message ?? params);
  });

  connection.onNotification("textDocument/publishDiagnostics", (params: any) => {
    const diagnostics = params.diagnostics ?? [];
    applyDiagnostics(monacoInstance, params.uri, diagnostics);
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
          console.log("[LSP] completion", { uri: modelUri(model), items: items.length });

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
          console.log("[LSP] hover", { uri: modelUri(model), hasResult: Boolean(result) });
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
          return locations.map((location: any) => ({
            uri: monacoInstance.Uri.parse(location.targetUri ?? location.uri),
            range: toMonacoRange(monacoInstance, location.targetRange ?? location.range),
          }));
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

async function indexWorkspaceKotlinFiles(
  monacoInstance: typeof monaco,
  workspacePath: string,
) {
  const files = collectKotlinFiles(useIDEStore.getState().files);
  const total = files.length;

  if (total === 0) {
    useIDEStore.getState().setLspIndexProgress(0, 0, "Ready - no Kotlin files found");
    setLspStatus("ready", "Ready - no Kotlin files found");
    return;
  }

  useIDEStore.getState().setLspIndexProgress(0, total, `Indexing Kotlin files (0/${total})`);

  for (let index = 0; index < files.length; index += 1) {
    if (!connection || activeWorkspacePath !== workspacePath) return;

    const file = files[index];
    const uri = monacoInstance.Uri.parse(fileUriFromPath(file.id));
    let model = monacoInstance.editor.getModel(uri);

    if (!model) {
      const text = await readTextFile(file.id).catch(() => "");
      model = monacoInstance.editor.createModel(text, "kotlin", uri);
    }

    attachModel(monacoInstance, model);
    useIDEStore.getState().setLspIndexProgress(
      index + 1,
      total,
      `Indexing Kotlin files (${index + 1}/${total})`,
    );
  }

  setLspStatus("ready", `Ready - indexed ${total} Kotlin file${total === 1 ? "" : "s"}`);
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
  monacoInstance: typeof monaco,
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

  const model = monacoInstance.editor.getModel(monacoInstance.Uri.parse(uri));
  if (!model) return;

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

function scheduleDocumentDiagnostics(
  monacoInstance: typeof monaco,
  model: monaco.editor.ITextModel,
) {
  const uri = modelUri(model);
  const existingTimer = diagnosticRefreshTimers.get(uri);
  if (existingTimer) clearTimeout(existingTimer);

  diagnosticRefreshTimers.set(
    uri,
    setTimeout(() => {
      diagnosticRefreshTimers.delete(uri);
      void requestDocumentDiagnostics(monacoInstance, model);
    }, 500),
  );
}

async function requestDocumentDiagnostics(
  monacoInstance: typeof monaco,
  model: monaco.editor.ITextModel,
) {
  if (!connection || model.getLanguageId() !== "kotlin") return;

  const uri = modelUri(model);

  try {
    const report: any = await connection.sendRequest("textDocument/diagnostic", {
      textDocument: { uri },
      previousResultId: null,
    });

    if (!report || report.kind === "unchanged") return;
    applyDiagnostics(monacoInstance, uri, report.items ?? []);
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
) {
  if (!connection || model.getLanguageId() !== "kotlin") return;

  const uri = modelUri(model);
  if (openedUris.has(uri)) return;
  openedUris.add(uri);
  console.log("[LSP] didOpen", { uri, languageId: model.getLanguageId() });

  connection.sendNotification("textDocument/didOpen", {
    textDocument: {
      uri,
      languageId: "kotlin",
      version: model.getVersionId(),
      text: model.getValue(),
    },
  });
  void requestDocumentDiagnostics(monacoInstance, model);

  modelDisposables.push(
    model.onDidChangeContent(() => {
      connection?.sendNotification("textDocument/didChange", {
        textDocument: { uri, version: model.getVersionId() },
        contentChanges: [{ text: model.getValue() }],
      });
      scheduleDocumentDiagnostics(monacoInstance, model);
    }),
  );

  modelDisposables.push(
    model.onWillDispose(() => {
      openedUris.delete(uri);
      diagnosticCountsByUri.delete(uri);
      useIDEStore.getState().setDiagnosticsForUri(uri, []);
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

function isNoisyMissingGradleScriptLog(message: unknown) {
  if (typeof message !== "string") return false;

  return (
    message.includes("SingleRootFileViewProvider") &&
    message.includes("file not found") &&
    (message.includes("build.gradle.kts") || message.includes("settings.gradle.kts"))
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
