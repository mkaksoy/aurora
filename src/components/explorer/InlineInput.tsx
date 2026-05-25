import { CreatingIcon } from "./fileIcons";

export interface InlineInputProps {
  depth: number;
  type: 'file' | 'folder';
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

export function InlineInput({ depth, type, value, onChange, onCommit, onCancel, inputRef }: InlineInputProps) {
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') onCommit();
    if (e.key === 'Escape') onCancel();
  }
  return (
    <div className="flex items-center gap-1.5 py-0.5 pr-3" style={{ paddingLeft: `${depth * 12 + 28}px` }}>
      <CreatingIcon name={value} type={type} />
      <div className="flex-1 flex items-center border border-primary rounded-sm overflow-hidden" style={{ background: "var(--editor-bg, #1e1e2e)" }}>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={onCommit}
          className="flex-1 bg-transparent px-1.5 py-0.5 text-sm text-foreground outline-none min-w-0"
        />
      </div>
    </div>
  );
}