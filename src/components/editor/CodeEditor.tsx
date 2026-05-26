import Editor from "@monaco-editor/react";
import { useIDEStore } from "@/store/ide-store";
import { auroraTheme } from "@/monacoTheme";
import { useEffect, useRef, type MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readTextFile } from "@tauri-apps/plugin-fs";
import * as monaco from "monaco-editor";
import { getLanguage, hasKotlinProjectFiles } from "@/components/explorer/fileExplorerUtils";
import {
  fileUriFromPath,
  notifyDocumentSaved,
  startKotlinLsp,
  stopKotlinLsp,
} from "./lib/kotlinLsp";

function registerKotlinLanguage(m: typeof monaco) {
  if (m.languages.getLanguages().some((language) => language.id === "kotlin")) {
    return;
  }

  m.languages.register({ id: "kotlin", extensions: [".kt", ".kts"] });

  m.languages.setMonarchTokensProvider("kotlin", {
    keywords: [
      "fun",
      "val",
      "var",
      "class",
      "object",
      "interface",
      "when",
      "if",
      "else",
      "for",
      "while",
      "return",
      "import",
      "package",
      "data",
      "sealed",
      "abstract",
      "override",
      "suspend",
      "companion",
    ],
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment"],
        [/".*?"/, "string"],
        [/\b(true|false|null)\b/, "keyword"],
        [/\b\d+\b/, "number"],
        [
          /\b(fun|val|var|class|object|interface|when|if|else|for|while|return|import|package|data|sealed|abstract|override|suspend|companion)\b/,
          "keyword",
        ],
      ],
    },
  });
}

export function CodeEditor() {
  const {
    tabs,
    activeTabId,
    files,
    projectRoot,
    pendingReveal,
    updateTabContent,
    saveTab,
    setPendingReveal,
  } =
    useIDEStore();
  const lspStartedFor = useRef<string | null>(null);
  const openerDisposable = useRef<monaco.IDisposable | null>(null);
  const monacoRef = useRef<typeof monaco | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const isKotlinProject = hasKotlinProjectFiles(files);

  function handleBeforeMount(monacoInstance: typeof monaco) {
    registerKotlinLanguage(monacoInstance);
    monacoInstance.editor.defineTheme("aurora", auroraTheme);
  }

  function handleEditorMount(
    editor: monaco.editor.IStandaloneCodeEditor,
    monacoInstance: typeof monaco,
  ) {
    editorRef.current = editor;
    monacoRef.current = monacoInstance;
    registerAuroraEditorOpener(monacoInstance, openerDisposable);
    if (!projectRoot || lspStartedFor.current === projectRoot) return;
    if (!isKotlinProject) return;

    lspStartedFor.current = projectRoot;
    startKotlinLsp(projectRoot, monacoInstance).catch((error) => {
      lspStartedFor.current = null;
      console.error("LSP baslatilamadi:", error);
    });
  }

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !activeTab || !pendingReveal) return;
    if (normalizePath(activeTab.path) !== normalizePath(pendingReveal.path)) return;

    editor.setPosition({
      lineNumber: pendingReveal.line,
      column: pendingReveal.column,
    });
    editor.revealLineInCenter(pendingReveal.line);
    editor.focus();
    setPendingReveal(null);
  }, [activeTab?.id, pendingReveal, setPendingReveal]);

  useEffect(() => {
    const monacoInstance = monacoRef.current;
    if (!monacoInstance) return;
    if (!projectRoot || lspStartedFor.current === projectRoot) return;
    if (!isKotlinProject) return;

    lspStartedFor.current = projectRoot;
    startKotlinLsp(projectRoot, monacoInstance).catch((error) => {
      lspStartedFor.current = null;
      console.error("LSP baslatilamadi:", error);
    });

    return () => {
      lspStartedFor.current = null;
      stopKotlinLsp().catch(console.error);
    };
  }, [projectRoot, isKotlinProject]);

  useEffect(() => {
    return () => {
      openerDisposable.current?.dispose();
      openerDisposable.current = null;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = async (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") {
        return;
      }

      event.preventDefault();
      if (!activeTab) return;

      await invoke("save_file", {
        path: activeTab.path,
        content: activeTab.content,
      });
      notifyDocumentSaved(activeTab.path, activeTab.content);
      saveTab(activeTab.id);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTab, saveTab]);

  if (!activeTab) {
    return (
      <div className="flex-1 flex items-center justify-center opacity-35">
        <img src="/aurora.svg" alt="Aurora" className="w-32 h-32 mb-4" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden">
      <Editor
        height="100%"
        path={fileUriFromPath(activeTab.path)}
        keepCurrentModel
        defaultLanguage={activeTab.language || "kotlin"}
        language={activeTab.language || "kotlin"}
        value={activeTab.content}
        beforeMount={handleBeforeMount}
        onMount={handleEditorMount}
        theme="aurora"
        onChange={(value) => updateTabContent(activeTab.id, value || "")}
        options={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 14,
          lineHeight: 24,
          padding: { top: 16 },
          minimap: { enabled: true },
          smoothScrolling: true,
          cursorSmoothCaretAnimation: "on",
          scrollBeyondLastLine: false,
          roundedSelection: true,
          renderLineHighlight: "all",
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
          overviewRulerBorder: false,
          hideCursorInOverviewRuler: true,
          folding: true,
          wordWrap: "off",
          automaticLayout: true,
          tabSize: 4,
          insertSpaces: true,
          guides: { indentation: true },
          glyphMargin: false,
          lineDecorationsWidth: 10,
          lineNumbersMinChars: 3,
          renderWhitespace: "selection",
          contextmenu: false,
        }}
      />
    </div>
  );
}

function registerAuroraEditorOpener(
  monacoInstance: typeof monaco,
  disposableRef: MutableRefObject<monaco.IDisposable | null>,
) {
  if (disposableRef.current) return;

  disposableRef.current = monacoInstance.editor.registerEditorOpener({
    async openCodeEditor(_source, resource, selectionOrPosition) {
      const path = resource.fsPath;
      if (!path) return false;

      const name = fileNameFromPath(path);
      const content = await readTextFile(path).catch(() => null);
      if (content === null) return false;

      const target = revealTargetFromSelection(path, selectionOrPosition);
      const { openFile, setPendingReveal } = useIDEStore.getState();

      openFile(
        {
          id: path,
          name,
          type: "file",
          content,
          language: getLanguage(name),
        },
        path,
      );
      setPendingReveal(target);

      return true;
    },
  });
}

function revealTargetFromSelection(
  path: string,
  selectionOrPosition?: monaco.IRange | monaco.IPosition,
) {
  const target = selectionOrPosition as Partial<monaco.IRange & monaco.IPosition> | undefined;

  return {
    path,
    line: target?.startLineNumber ?? target?.lineNumber ?? 1,
    column: target?.startColumn ?? target?.column ?? 1,
  };
}

function fileNameFromPath(path: string) {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/").toLowerCase();
}
