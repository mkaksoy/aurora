import { FileCode2, Folder } from "lucide-react";

const EXT_COLORS: Record<string, string> = {
  kt: "var(--primary)",
  ts: "#3178c6", tsx: "#3178c6",
  js: "#f7df1e", jsx: "#f7df1e",
  json: "#cbcb41",
  html: "#e44d26",
  css: "#264de4", scss: "#c69",
  md: "#519aba",
  py: "#3572A5",
  java: "#b07219",
  rs: "#ce412b",
  go: "#00acd7",
  xml: "#e37933",
  yml: "#cb171e", yaml: "#cb171e",
};

const KT_PATH = "M1.25 2C1.25 1.58579 1.58579 1.25 2 1.25H14C14.3033 1.25 14.5768 1.43273 14.6929 1.71299C14.809 1.99324 14.7448 2.31583 14.5303 2.53033L9.06066 8L14.5303 13.4697C14.7448 13.6842 14.809 14.0068 14.6929 14.287C14.5768 14.5673 14.3033 14.75 14 14.75H2C1.58579 14.75 1.25 14.4142 1.25 14V2ZM2.75 2.75V13.25H12.1893L7.46967 8.53033C7.17678 8.23744 7.17678 7.76256 7.46967 7.46967L12.1893 2.75H2.75Z";

export function KotlinIcon({ size = 16 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 16 16">
      <path fillRule="evenodd" clipRule="evenodd" d={KT_PATH} fill="var(--primary)" />
    </svg>
  );
}

function FileOutlineIcon({ size = 15, color }: { size?: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ color }} className="shrink-0">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function getFileIcon(name: string) {
  if (name.endsWith(".kt")) return <KotlinIcon />;
  if (name.endsWith(".gradle.kts")) return <FileCode2 size={16} className="shrink-0 text-(--syntax-function)" />;
  return <FileCode2 size={16} className="shrink-0 text-muted-foreground" />;
}

export function CreatingIcon({ name, type }: { name: string; type: 'file' | 'folder' }) {
  if (type === 'folder') return <Folder size={15} style={{ color: "var(--syntax-type, #e8bf6a)" }} className="shrink-0" />;
  if (name.endsWith(".kt")) return <KotlinIcon size={15} />;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const hasExt = name.includes(".") && ext.length > 0;
  const color = hasExt ? (EXT_COLORS[ext] ?? "var(--muted-foreground)") : "var(--muted-foreground)";
  return <FileOutlineIcon color={color} />;
}