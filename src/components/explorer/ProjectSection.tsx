import React from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  FolderX,
  FilePlus,
  FolderPlus,
} from "lucide-react";
import { useIDEStore } from "@/store/ide-store";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { FileTreeItem } from "./FileTreeItem";
import { InlineInput } from "./InlineInput";
import {
  joinPath,
  getFolderName,
  hasKotlinProjectFiles,
  readDirRecursive,
  watchDirectory,
} from "./fileExplorerUtils";
import { startKotlinLsp, stopKotlinLsp } from "@/lib/lsp";

type CreatingType = "file" | "folder" | null;

function useProjectState() {
  const { files, setFiles, setProjectRoot } = useIDEStore();
  const [expanded, setExpanded] = React.useState(true);
  const [loading, setLoading] = React.useState(false);
  const [projectName, setProjectName] = React.useState<string | null>(null);
  const [rootPath, setRootPath] = React.useState("");
  const [selectedFolderId, setSelectedFolderId] = React.useState<string | null>(
    null,
  );
  const [selectedFolderPath, setSelectedFolderPath] = React.useState("");
  const [selectedFileTreeId, setSelectedFileTreeId] = React.useState<
    string | null
  >(null);
  const [selectedFilePath, setSelectedFilePath] = React.useState("");
  const [selectedFileDepth, setSelectedFileDepth] = React.useState(0);
  const [creating, setCreating] = React.useState<CreatingType>(null);
  const [newName, setNewName] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const watcherRef = React.useRef<(() => void) | null>(null);
  const rootPathRef = React.useRef("");

  React.useEffect(() => {
    if (creating) setTimeout(() => inputRef.current?.focus(), 50);
  }, [creating]);

  async function startWatcher(path: string) {
    watcherRef.current?.();
    watcherRef.current = await watchDirectory(path, async () => {
      const nodes = await readDirRecursive(rootPathRef.current);
      setFiles(nodes);
    });
  }

  React.useEffect(() => {
    return () => {
      watcherRef.current?.();
    };
  }, []);

  function selectFolder(id: string, path: string) {
    setSelectedFolderId(id);
    setSelectedFolderPath(path);
    setSelectedFileTreeId(null);
    setSelectedFilePath("");
    setSelectedFileDepth(0);
  }

  function selectFile(id: string, path: string, depth: number) {
    setSelectedFileTreeId(id);
    setSelectedFilePath(path);
    setSelectedFileDepth(depth);
    setSelectedFolderId(null);
    setSelectedFolderPath("");
  }

  function clearSelection() {
    setSelectedFolderId(null);
    setSelectedFolderPath("");
    setSelectedFileTreeId(null);
    setSelectedFilePath("");
    setSelectedFileDepth(0);
  }

  function getTargetPath(): string {
    if (selectedFolderPath) return selectedFolderPath;
    if (selectedFilePath) {
      const sep = selectedFilePath.includes("\\") ? "\\" : "/";
      return selectedFilePath.split(sep).slice(0, -1).join(sep) || rootPath;
    }
    return rootPath;
  }

  async function openProject() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });

      if (!selected) return;

      const path = (Array.isArray(selected) ? selected[0] : selected) as string;

      setLoading(true);

      rootPathRef.current = path;

      setProjectName(getFolderName(path));
      setRootPath(path);

      clearSelection();
      setExpanded(true);

      const nodes = await readDirRecursive(path);
      setFiles(nodes);
      setProjectRoot(path);
      if (hasKotlinProjectFiles(nodes)) {
        void startKotlinLsp(path).catch((error) => {
          console.error("LSP baslatilamadi:", error);
        });
      } else {
        void stopKotlinLsp().catch(console.error);
      }

      await startWatcher(path);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function closeProject() {
    try {
      await stopKotlinLsp();
    } catch (err) {
      console.error(err);
    }

    watcherRef.current?.();
    watcherRef.current = null;

    rootPathRef.current = "";

    setProjectName(null);
    setRootPath("");

    clearSelection();
    setFiles([]);

    setProjectRoot("");
  }

  async function commitNew() {
    const name = newName.trim();
    if (!name || !rootPathRef.current) {
      setCreating(null);
      setNewName("");
      return;
    }
    try {
      await invoke(
        creating === "file" ? "create_file" : "create_folder",
        creating === "file"
          ? { path: joinPath(getTargetPath(), name), content: "" }
          : { path: joinPath(getTargetPath(), name) },
      );
      setFiles(await readDirRecursive(rootPathRef.current));
    } catch (err) {
      console.error(err);
    } finally {
      setCreating(null);
      setNewName("");
    }
  }

  function cancelNew() {
    setCreating(null);
    setNewName("");
  }

  return {
    files,
    expanded,
    setExpanded,
    loading,
    projectName,
    rootPath,
    selectedFolderId,
    selectedFileTreeId,
    selectedFileDepth,
    creating,
    setCreating,
    newName,
    setNewName,
    inputRef,
    isCreatingInRoot: !selectedFolderId && !selectedFileTreeId,
    selectFolder,
    selectFile,
    openProject,
    closeProject,
    commitNew,
    cancelNew,
  };
}

export function ProjectSection() {
  const s = useProjectState();

  return (
    <div>
      <div className="flex items-center justify-between px-2 py-1 group">
        <button
          onClick={() => s.setExpanded((v) => !v)}
          className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
        >
          {s.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Project
        </button>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {s.projectName && (
            <>
              <button
                onClick={() => {
                  s.setCreating("file");
                  s.setExpanded(true);
                }}
                title="New file"
                className="p-0.5 rounded hover:bg-(--sidebar-item-hover) text-muted-foreground hover:text-foreground transition-colors"
              >
                <FilePlus size={13} />
              </button>
              <button
                onClick={() => {
                  s.setCreating("folder");
                  s.setExpanded(true);
                }}
                title="New folder"
                className="p-0.5 rounded hover:bg-(--sidebar-item-hover) text-muted-foreground hover:text-foreground transition-colors"
              >
                <FolderPlus size={13} />
              </button>
              <button
                onClick={s.closeProject}
                title="Close project"
                className="p-0.5 rounded hover:bg-(--sidebar-item-hover) text-muted-foreground hover:text-foreground transition-colors"
              >
                <FolderX size={13} />
              </button>
            </>
          )}
          <button
            onClick={s.openProject}
            disabled={s.loading}
            title="Open project"
            className="p-0.5 rounded hover:bg-(--sidebar-item-hover) text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            <FolderOpen size={13} />
          </button>
        </div>
      </div>

      {s.expanded && (
        <div>
          {s.loading && (
            <p className="text-xs text-muted-foreground px-4 py-1">
              Loading...
            </p>
          )}
          {!s.loading && !s.projectName && (
            <p className="text-xs text-muted-foreground px-4 py-1">
              No project open
            </p>
          )}
          {!s.loading &&
            s.projectName &&
            s.files.length === 0 &&
            !s.creating && (
              <p className="text-xs text-muted-foreground px-4 py-1">
                Empty folder
              </p>
            )}
          {!s.loading &&
            s.projectName &&
            s.files.map((node) => (
              <FileTreeItem
                key={node.id}
                node={node}
                depth={0}
                absolutePath={joinPath(s.rootPath, node.name)}
                selectedFolderId={s.selectedFolderId}
                selectedFileTreeId={s.selectedFileTreeId}
                onFolderSelect={(id, path) => s.selectFolder(id, path)}
                onFileSelect={(id, path, depth) =>
                  s.selectFile(id, path, depth)
                }
                creatingInFolderId={s.creating ? s.selectedFolderId : null}
                creatingType={s.creating}
                creatingName={s.newName}
                onCreatingNameChange={s.setNewName}
                onCreatingCommit={s.commitNew}
                onCreatingCancel={s.cancelNew}
                creatingInputRef={s.inputRef}
              />
            ))}

          {s.creating && (s.isCreatingInRoot || s.selectedFileTreeId) && (
            <InlineInput
              depth={s.selectedFileTreeId ? s.selectedFileDepth : 0}
              type={s.creating}
              value={s.newName}
              onChange={s.setNewName}
              onCommit={s.commitNew}
              onCancel={s.cancelNew}
              inputRef={s.inputRef}
            />
          )}
        </div>
      )}
    </div>
  );
}
