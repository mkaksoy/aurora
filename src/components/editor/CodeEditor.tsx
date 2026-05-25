import Editor from "@monaco-editor/react";
import { useIDEStore } from "@/store/ide-store";
import { auroraTheme } from "@/monacoTheme";
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as monaco from "monaco-editor";
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
    projectRoot,
    pendingReveal,
    updateTabContent,
    saveTab,
    setPendingReveal,
  } =
    useIDEStore();
  const lspStartedFor = useRef<string | null>(null);
  const monacoRef = useRef<typeof monaco | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);

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
    if (activeTab) {
      setEditorModel(editor, ensureModel(monacoInstance, activeTab));
    }
    if (!projectRoot || lspStartedFor.current === projectRoot) return;

    lspStartedFor.current = projectRoot;
    startKotlinLsp(projectRoot, monacoInstance).catch((error) => {
      lspStartedFor.current = null;
      console.error("LSP baslatilamadi:", error);
    });
  }

  useEffect(() => {
    const editor = editorRef.current;
    const monacoInstance = monacoRef.current;
    if (!editor || !monacoInstance || !activeTab) return;

    const model = ensureModel(monacoInstance, activeTab);
    if (editor.getModel() !== model) {
      setEditorModel(editor, model);
    }
  }, [activeTab?.id]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !activeTab || !pendingReveal) return;
    if (activeTab.path !== pendingReveal.path) return;

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

    lspStartedFor.current = projectRoot;
    startKotlinLsp(projectRoot, monacoInstance).catch((error) => {
      lspStartedFor.current = null;
      console.error("LSP baslatilamadi:", error);
    });

    return () => {
      lspStartedFor.current = null;
      stopKotlinLsp().catch(console.error);
    };
  }, [projectRoot]);

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

function ensureModel(monacoInstance: typeof monaco, tab: {
  path: string;
  content: string;
  language: string;
}) {
  const uri = monacoInstance.Uri.parse(fileUriFromPath(tab.path));
  let model = monacoInstance.editor.getModel(uri);

  if (!model) {
    model = monacoInstance.editor.createModel(
      tab.content,
      tab.language || "kotlin",
      uri,
    );
  } else if (model.getValue() !== tab.content) {
    model.setValue(tab.content);
  }

  return model;
}

function setEditorModel(
  editor: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
) {
  try {
    editor.setModel(model);
  } catch (error) {
    if (!isMonacoCanceled(error)) throw error;
  }
}

function isMonacoCanceled(error: unknown) {
  const value = error as { name?: string; message?: string };
  const text = String(value?.message ?? value ?? "");

  return value?.name === "Canceled" || text === "Canceled" || text.includes("Canceled: Canceled");
}
