import { 
  Files, 
  Search, 
  GitBranch, 
  Bug, 
  Package,
  Settings,
  type LucideIcon
} from 'lucide-react'
import { useIDEStore } from '@/store/ide-store'
import { cn } from '@/lib/utils'

interface ActivityItem {
  id: 'explorer' | 'search' | 'git' | 'debug' | 'extensions'
  icon: LucideIcon
  label: string
}

const activities: ActivityItem[] = [
  { id: 'explorer', icon: Files, label: 'Explorer' },
  { id: 'search', icon: Search, label: 'Search' },
  { id: 'git', icon: GitBranch, label: 'Source Control' },
  { id: 'debug', icon: Bug, label: 'Run and Debug' },
  { id: 'extensions', icon: Package, label: 'Extensions' },
]

export function ActivityBar() {
  const { activePanel, setActivePanel } = useIDEStore()
  
  return (
    <div 
      className="flex flex-col items-center w-12 py-2 gap-1"
      style={{ background: 'var(--activity-bg)' }}
    >
      {activities.map((item) => (
        <button
          key={item.id}
          onClick={() => setActivePanel(item.id)}
          className={cn(
            "w-10 h-10 flex items-center justify-center rounded-md transition-colors relative group",
            activePanel === item.id 
              ? "text-(--activity-icon-active)" 
              : "text-(--activity-icon) hover:text-(--activity-icon-active)"
          )}
          title={item.label}
        >
          {activePanel === item.id && (
            <div 
              className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-r"
              style={{ background: 'var(--primary)' }}
            />
          )}
          <item.icon size={22} strokeWidth={1.5} />
        </button>
      ))}
      
      <div className="flex-1" />
      
      <button
        className="w-10 h-10 flex items-center justify-center rounded-md transition-colors text-(--activity-icon) hover:text-(--activity-icon-active)"
        title="Settings"
      >
        <Settings size={22} strokeWidth={1.5} />
      </button>
    </div>
  )
}
