import React from "react";
import { ChevronDown, ChevronRight, FolderPlus, X } from "lucide-react";
import { type FileNode } from "@/store/ide-store";
import { open } from "@tauri-apps/plugin-dialog";
import { FileTreeItem } from "./FileTreeItem";
import { joinPath, getFolderName, readDirRecursive } from "./fileExplorerUtils";

interface FolderEntry {
  id: string;
  name: string;
  rootPath: string;
  nodes: FileNode[];
  expanded: boolean;
  loading: boolean;
}

export function FoldersSection() {
  const [folders, setFolders] = React.useState<FolderEntry[]>([]);
  const [sectionExpanded, setSectionExpanded] = React.useState(true);

  async function addFolder() {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected) return;
      const folderPath = (Array.isArray(selected) ? selected[0] : selected) as string;
      const id = crypto.randomUUID();

      setFolders((prev) => [
        ...prev,
        { id, name: getFolderName(folderPath), rootPath: folderPath, nodes: [], expanded: true, loading: true },
      ]);

      const nodes = await readDirRecursive(folderPath);
      setFolders((prev) => prev.map((f) => f.id === id ? { ...f, nodes, loading: false } : f));
    } catch (err) {
      console.error("Folder could not be added:", err);
    }
  }

  function removeFolder(id: string) {
    setFolders((prev) => prev.filter((f) => f.id !== id));
  }

  function toggleFolder(id: string) {
    setFolders((prev) => prev.map((f) => f.id === id ? { ...f, expanded: !f.expanded } : f));
  }

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center justify-between px-2 py-1 group">
        <button
          onClick={() => setSectionExpanded((v) => !v)}
          className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
        >
          {sectionExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Folders
        </button>
        <button
          onClick={addFolder}
          title="Add folder"
          className="p-0.5 rounded hover:bg-(--sidebar-item-hover) text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
        >
          <FolderPlus size={13} />
        </button>
      </div>

      {/* Folder list */}
      {sectionExpanded && (
        <div>
          {folders.length === 0 && (
            <p className="text-xs text-muted-foreground px-4 py-1">No folders added</p>
          )}

          {folders.map((folder) => (
            <div key={folder.id}>
              {/* Folder header row */}
              <div className="flex items-center group/folder hover:bg-(--sidebar-item-hover) transition-colors pr-1">
                <button
                  onClick={() => toggleFolder(folder.id)}
                  className="flex items-center gap-1 flex-1 min-w-0 px-2 py-0.5 text-xs font-medium text-foreground"
                >
                  {folder.expanded
                    ? <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
                    : <ChevronRight size={12} className="shrink-0 text-muted-foreground" />}
                  <span className="truncate" title={folder.rootPath}>
                    {folder.name}
                  </span>
                  {folder.loading && (
                    <span className="ml-1 text-muted-foreground shrink-0">…</span>
                  )}
                </button>
                <button
                  onClick={() => removeFolder(folder.id)}
                  title="Remove folder"
                  className="shrink-0 p-0.5 rounded hover:bg-(--sidebar-item-active) text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover/folder:opacity-100"
                >
                  <X size={12} />
                </button>
              </div>

              {/* Folder tree */}
              {folder.expanded && !folder.loading && (
                <div>
                  {folder.nodes.length === 0 && (
                    <p className="text-xs text-muted-foreground px-6 py-0.5">Empty</p>
                  )}
                  {folder.nodes.map((node) => (
                    <FileTreeItem
                      key={node.id}
                      node={node}
                      depth={1}
                      absolutePath={joinPath(folder.rootPath, node.name)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}