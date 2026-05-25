import { ChevronRight, ChevronDown, Folder, FolderOpen } from "lucide-react";
import { useIDEStore, type FileNode } from "@/store/ide-store";
import { cn } from "@/lib/utils";
import { joinPath, readFileContent } from "./fileExplorerUtils";
import { getFileIcon } from "./fileIcons";
import { InlineInput } from "./InlineInput";

export interface FileTreeItemProps {
  node: FileNode;
  depth: number;
  absolutePath: string;
  selectedFolderId?: string | null;
  selectedFileTreeId?: string | null;
  onFolderSelect?: (id: string, absolutePath: string, depth: number) => void;
  onFileSelect?: (id: string, absolutePath: string, depth: number) => void;
  creatingInFolderId?: string | null;
  creatingType?: 'file' | 'folder' | null;
  creatingName?: string;
  onCreatingNameChange?: (v: string) => void;
  onCreatingCommit?: () => void;
  onCreatingCancel?: () => void;
  creatingInputRef?: React.RefObject<HTMLInputElement | null>;
}

export function FileTreeItem({
  node, depth, absolutePath,
  selectedFolderId, selectedFileTreeId,
  onFolderSelect, onFileSelect,
  creatingInFolderId, creatingType, creatingName,
  onCreatingNameChange, onCreatingCommit, onCreatingCancel, creatingInputRef,
}: FileTreeItemProps) {
  const { expandedFolders, toggleFolder, openFile } = useIDEStore();
  const isExpanded = expandedFolders.has(node.id);

  if (node.type === "folder") {
    const isSelected = selectedFolderId === node.id;
    const showInput = creatingInFolderId === node.id && creatingType && creatingInputRef;

    return (
      <div>
        <button
          onClick={() => { toggleFolder(node.id); onFolderSelect?.(node.id, absolutePath, depth); }}
          className={cn(
            "w-full flex items-center py-0.5 text-sm transition-colors text-foreground",
            isSelected ? "bg-(--sidebar-item-active)" : "hover:bg-(--sidebar-item-hover)"
          )}
        >
          <span
            className="flex items-center gap-1 min-w-0 w-full"
            style={{ paddingLeft: `${depth * 12 + 8}px`, paddingRight: "16px" }}
          >
            {isExpanded
              ? <ChevronDown size={16} className="shrink-0 text-muted-foreground" />
              : <ChevronRight size={16} className="shrink-0 text-muted-foreground" />}
            {isExpanded
              ? <FolderOpen size={16} className="shrink-0 text-(--syntax-type)" />
              : <Folder size={16} className="shrink-0 text-(--syntax-type)" />}
            <span className="truncate">{node.name}</span>
          </span>
        </button>

        {showInput && (
          <InlineInput
            depth={depth + 1}
            type={creatingType!}
            value={creatingName ?? ""}
            onChange={onCreatingNameChange!}
            onCommit={onCreatingCommit!}
            onCancel={onCreatingCancel!}
            inputRef={creatingInputRef!}
          />
        )}

        {isExpanded && node.children && (
          <div>
            {node.children.map((child) => (
              <FileTreeItem
                key={child.id}
                node={child}
                depth={depth + 1}
                absolutePath={joinPath(absolutePath, child.name)}
                selectedFolderId={selectedFolderId}
                selectedFileTreeId={selectedFileTreeId}
                onFolderSelect={onFolderSelect}
                onFileSelect={onFileSelect}
                creatingInFolderId={creatingInFolderId}
                creatingType={creatingType}
                creatingName={creatingName}
                onCreatingNameChange={onCreatingNameChange}
                onCreatingCommit={onCreatingCommit}
                onCreatingCancel={onCreatingCancel}
                creatingInputRef={creatingInputRef}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  async function handleClick() {
    onFileSelect?.(node.id, absolutePath, depth);
    const content = node.content || await readFileContent(absolutePath);
    openFile({ ...node, content }, absolutePath);
  }

  return (
    <button
      onClick={handleClick}
      className={cn(
        "w-full flex items-center py-0.5 text-sm transition-colors text-foreground",
        selectedFileTreeId === node.id ? "bg-(--sidebar-item-active)" : "hover:bg-(--sidebar-item-hover)"
      )}
    >
      <span
        className="flex items-center gap-1.5 min-w-0 w-full"
        style={{ paddingLeft: `${depth * 12 + 28}px`, paddingRight: "16px" }}
      >
        {getFileIcon(node.name)}
        <span className="truncate">{node.name}</span>
      </span>
    </button>
  );
}