import React from "react";
import { useIDEStore } from "@/store/ide-store";
import { ProjectSection } from "./ProjectSection";
import { FoldersSection } from "./FoldersSection";

export function FileExplorer() {
  const { setSidebarWidth } = useIDEStore();
  const [isResizing, setIsResizing] = React.useState(false);
  const [borderActive, setBorderActive] = React.useState(false);

  const sidebarRef = React.useRef<HTMLDivElement>(null);
  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const isResizingRef = React.useRef(false); // ← closure'dan bağımsız güncel değer

  // Timer'ı component unmount'ta temizle (memory leak önlemi)
  React.useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  const handleMouseDownOnResizer = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();

      // DOM traversal yerine direkt ref kullan
      const startWidth = sidebarRef.current?.offsetWidth ?? 240;
      const startX = e.clientX;

      setIsResizing(true);
      isResizingRef.current = true;
      setBorderActive(true);

      const onMouseMove = (ev: MouseEvent) => {
        const newWidth = Math.min(600, Math.max(160, startWidth + ev.clientX - startX));
        setSidebarWidth(newWidth);
      };

      const onMouseUp = () => {
        setIsResizing(false);
        isResizingRef.current = false;
        setBorderActive(false);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      // { passive: true } yok çünkü mousemove'da preventDefault gerekmez
      // ama capture: false ile doğru sıra garantilenir
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [setSidebarWidth]
  );

  const handleBorderMouseEnter = React.useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current); // çift girişe karşı
    hoverTimerRef.current = setTimeout(() => setBorderActive(true), 500);
  }, []);

  const handleBorderMouseLeave = React.useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    // State değil ref kullan — closure stale olmaz
    if (!isResizingRef.current) setBorderActive(false);
  }, []);

  return (
  <div
    ref={sidebarRef}
    data-sidebar
    className="h-full flex relative"
    style={{ background: "var(--sidebar-bg)" }}
  >
    {/* Sol kolon: asıl içerik */}
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider shrink-0">
        Explorer
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <ProjectSection />
        <div className="my-1 mx-2 border-t border-border" />
        <FoldersSection />
      </div>
    </div>

    {/* Sağ kolon: resize handle — sabit 12px genişlik */}
    <div
      onMouseDown={handleMouseDownOnResizer}
      onMouseEnter={handleBorderMouseEnter}
      onMouseLeave={handleBorderMouseLeave}
      className="shrink-0 w-3 h-full flex items-center justify-center"
      style={{ cursor: "ew-resize", zIndex: 10 }}
    >
      <div
        className="h-full"
        style={{
          width: borderActive || isResizing ? "2px" : "1px",
          background: borderActive || isResizing ? "var(--primary)" : "var(--border)",
          transition: "width 150ms ease, background 150ms ease",
        }}
      />
    </div>
  </div>
);
}