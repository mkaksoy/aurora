import fs from "fs/promises"
import path from "path"

export interface FileNode {
  id: string
  name: string
  type: "file" | "folder"
  children?: FileNode[]
  content?: string
  language?: string
}

const LANGUAGE_MAP: Record<string, string> = {
  ".kt": "kotlin",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".json": "json",
  ".html": "html",
  ".css": "css",
  ".scss": "scss",
  ".md": "markdown",
  ".py": "python",
  ".java": "java",
  ".c": "c",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".go": "go",
  ".rs": "rust",
  ".php": "php",
  ".xml": "xml",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".txt": "text",
}

function generateId() {
  return crypto.randomUUID()
}

function getLanguage(fileName: string) {
  const ext = path.extname(fileName).toLowerCase()
  return LANGUAGE_MAP[ext] || "text"
}

const IGNORED_FOLDERS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "out",
])

export async function openFolder(folderPath: string): Promise<FileNode[]> {
  async function readDirRecursive(currentPath: string): Promise<FileNode[]> {
    const entries = await fs.readdir(currentPath, {
      withFileTypes: true,
    })

    const nodes: FileNode[] = []

    for (const entry of entries) {
      if (IGNORED_FOLDERS.has(entry.name)) continue

      const fullPath = path.join(currentPath, entry.name)

      if (entry.isDirectory()) {
        const children = await readDirRecursive(fullPath)

        nodes.push({
          id: generateId(),
          name: entry.name,
          type: "folder",
          children,
        })
      } else {
        let content = ""

        try {
          content = await fs.readFile(fullPath, "utf-8")
        } catch {
          content = ""
        }

        nodes.push({
          id: generateId(),
          name: entry.name,
          type: "file",
          language: getLanguage(entry.name),
          content,
        })
      }
    }

    return nodes.sort((a, b) => {
      if (a.type === "folder" && b.type === "file") return -1
      if (a.type === "file" && b.type === "folder") return 1

      return a.name.localeCompare(b.name)
    })
  }

  return await readDirRecursive(folderPath)
}