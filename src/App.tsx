import { TitleBar } from "@/components/TitleBar";
import { ActivityBar } from "@/components/ActivityBar";
import { FileExplorer } from "@/components/explorer/FileExplorer";
import { TabBar } from "@/components/TabBar";
import { CodeEditor } from "@/components/editor/CodeEditor";
import { TerminalPanel } from "@/components/TerminalPanel";
import { StatusBar } from "@/components/StatusBar";
import { useIDEStore } from "@/store/ide-store";


function SearchPanel() {
  return (
    <div className="h-full p-4" style={{ background: "var(--sidebar-bg)" }}>
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Search
      </div>
      <input
        type="text"
        placeholder="Search files..."
        className="w-full px-3 py-1.5 text-sm rounded-md outline-none"
        style={{ background: "var(--input)" }}
      />
    </div>
  );
}

function GitPanel() {
  return (
    <div className="h-full p-4" style={{ background: "var(--sidebar-bg)" }}>
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Source Control
      </div>
      <p className="text-sm text-muted-foreground">No changes</p>
    </div>
  );
}

function DebugPanel() {
  return (
    <div className="h-full p-4" style={{ background: "var(--sidebar-bg)" }}>
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Run and Debug
      </div>
      <p className="text-sm text-muted-foreground">
        Run your Kotlin application
      </p>
    </div>
  );
}

function ExtensionsPanel() {
  return (
    <div className="h-full p-4" style={{ background: "var(--sidebar-bg)" }}>
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Extensions
      </div>
      <p className="text-sm text-muted-foreground">Manage extensions</p>
    </div>
  );
}

function App() {
  const { activePanel, sidebarWidth } = useIDEStore();

  const renderPanel = () => {
    switch (activePanel) {
      case "explorer":
        return <FileExplorer />;
      case "search":
        return <SearchPanel />;
      case "git":
        return <GitPanel />;
      case "debug":
        return <DebugPanel />;
      case "extensions":
        return <ExtensionsPanel />;
      default:
        return <FileExplorer />;
    }
  };

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-background">
      <TitleBar />

      <div className="flex-1 flex overflow-hidden">
        <ActivityBar />

        <div
          className="shrink-0 overflow-hidden"
          style={{ width: sidebarWidth }}
        >
          {renderPanel()}
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          <TabBar />
          <CodeEditor />
          <TerminalPanel />
        </div>
      </div>

      <StatusBar />
    </div>
  );
}

export default App;
