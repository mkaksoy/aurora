import { readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { watch } from "@tauri-apps/plugin-fs";
import type { FileNode } from "@/store/ide-store";

export const IGNORED = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out",
  ".gradle", ".idea", "__pycache__", ".dart_tool", "target",
]);

export const LANGUAGE_MAP: Record<string, string> = {
  kt: "kotlin", ts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript", json: "json",
  html: "html", css: "css", scss: "scss", md: "markdown",
  py: "python", java: "java", rs: "rust", go: "go",
  xml: "xml", yml: "yaml", yaml: "yaml", txt: "text",
};

export function getLanguage(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGE_MAP[ext] ?? "text";
}

export function joinPath(base: string, name: string): string {
  const sep = base.includes("\\") ? "\\" : "/";
  return base.endsWith(sep) ? base + name : base + sep + name;
}

export function getFolderName(folderPath: string): string {
  const parts = folderPath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? "Folder";
}

// ID olarak path kullan — yenilemede stable, expandedFolders korunur
export async function readDirRecursive(dirPath: string): Promise<FileNode[]> {
  let entries: any[];
  try {
    entries = await readDir(dirPath);
  } catch (e) {
    console.warn("readDir failed:", dirPath, e);
    return [];
  }

  const nodes: FileNode[] = [];
  for (const entry of entries) {
    const name: string = entry.name;
    if (!name || IGNORED.has(name)) continue;
    const entryPath = joinPath(dirPath, name);
    if (entry.isDirectory === true) {
      nodes.push({ id: entryPath, name, type: "folder", children: await readDirRecursive(entryPath) });
    } else if (entry.isFile === true) {
      nodes.push({ id: entryPath, name, type: "file", content: "", language: getLanguage(name) });
    }
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function readFileContent(absolutePath: string): Promise<string> {
  try { return await readTextFile(absolutePath); }
  catch { return ""; }
}

export function hasKotlinProjectFiles(nodes: FileNode[]): boolean {
  return nodes.some((node) => {
    if (node.type === "folder") return hasKotlinProjectFiles(node.children ?? []);

    return (
      node.language === "kotlin" ||
      node.name.endsWith(".kt") ||
      node.name.endsWith(".kts") ||
      node.name === "build.gradle" ||
      node.name === "settings.gradle"
    );
  });
}

export async function watchDirectory(
  path: string,
  onChange: () => void,
): Promise<() => void> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    const unwatch = await watch(
      path,
      (_event) => {
        clearTimeout(timer);
        timer = setTimeout(onChange, 800);
      },
      { recursive: true },
    );
    return () => { clearTimeout(timer); unwatch(); };
  } catch (e) {
    console.warn("File watcher failed:", e);
    return () => {};
  }
}
