import { Minus, Square, X, Play, ChevronDown, Search } from 'lucide-react'
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open }from '@tauri-apps/plugin-dialog';

const appWindow = getCurrentWindow();

function logWindowError(action: string, error: unknown) {
  console.error(`[window:${action}]`, error);
}

export function TitleBar() {
  const menuItems = ['File', 'Edit', 'View', 'Navigate', 'Code', 'Run', 'Tools', 'Window', 'Help']
  
  return (
    <div 
      className="h-10 flex items-center justify-between pl-1 border-b border-border select-none shrink-0"
      style={{ background: 'var(--activity-bg)' }}
      data-tauri-drag-region
    >
      {/* Left: Logo and Menu */}
      <div className="flex items-center gap-1">
        <div
          className="flex items-center gap-2 px-2 h-10"
          data-tauri-drag-region
        >
          <img src="/aurora.svg" alt="Aurora" />
          <span className="font-semibold text-sm text-foreground">Aurora</span>
        </div>
        
        <div className="flex items-center">
          {menuItems.map((item) => (
            <button
              key={item}
                onClick={async () => {
                if (item === 'File') {
                  // todo : const folder =
                  await open({
                    multiple: false,
                    directory: true,
                  });
                }
              }}
              className="px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-sm transition-colors"
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      
      {/* Center: Search */}
      <div className="flex-1 max-w-md mx-4">
        <div 
          className="flex items-center gap-2 px-3 py-1 rounded-md text-sm text-muted-foreground cursor-pointer hover:bg-secondary/50 transition-colors"
          style={{ background: 'var(--input)' }}
        >
          <Search size={14} />
          <span className="text-xs">Search Everywhere</span>
          <span className="ml-auto text-xs opacity-50">Double Shift</span>
        </div>
      </div>
      
      {/* Right: Actions and Window Controls */}
      <div className="flex items-center gap-1">
        <button className="flex items-center gap-1.5 px-3 py-1 text-xs rounded-md transition-colors bg-(--terminal-green) text-black hover:opacity-90">
          <Play size={12} fill="currentColor" />
          Run
          <ChevronDown size={12} />
        </button>
        
        <div className="flex items-center ml-2">
          <button onClick={() => appWindow.minimize().catch((error) => logWindowError('minimize', error))} className="w-12 h-10 flex items-center justify-center hover:bg-secondary/50 transition-colors text-muted-foreground hover:text-foreground">
            <Minus size={16} />
          </button>
          <button onClick={() => appWindow.toggleMaximize().catch((error) => logWindowError('toggleMaximize', error))} className="w-12 h-10 flex items-center justify-center hover:bg-secondary/50 transition-colors text-muted-foreground hover:text-foreground">
            <Square size={14} />
          </button>
          <button onClick={() => appWindow.close().catch((error) => logWindowError('close', error))} className="w-12 h-10 flex items-center justify-center hover:bg-destructive/80 hover:text-white transition-colors text-muted-foreground">
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
