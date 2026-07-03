import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, PenTool, Puzzle, Settings, LogOut, Zap, Server } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useUIStore } from '../../store/uiStore';
import { clsx } from 'clsx';

const Sidebar: React.FC = () => {
  const logout = useAuthStore((state) => state.logout);
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);

  const menuItems = [
    { name: 'Dashboard', icon: LayoutDashboard, path: '/' },
    { name: 'Task Composer', icon: PenTool, path: '/tasks' },
    { name: 'Connectors', icon: Puzzle, path: '/connectors' },
    { name: 'Skills', icon: Zap, path: '/skills' },
    { name: 'MCP Servers', icon: Server, path: '/mcp' },
    { name: 'Settings', icon: Settings, path: '/settings' },
  ];

  return (
    <aside className={clsx(
      "bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-all duration-300 flex flex-col",
      sidebarOpen ? "w-64" : "w-20"
    )}>
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold">O</div>
        {sidebarOpen && <span className="text-xl font-bold text-slate-900 dark:text-white">Orchestrator</span>}
      </div>

      <nav className="flex-1 px-4 py-4 space-y-2">
        {menuItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => clsx(
              "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
              isActive 
                ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400" 
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            )}
          >
            <item.icon size={20} />
            {sidebarOpen && <span>{item.name}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-200 dark:border-slate-800">
        <button
          onClick={logout}
          className="flex items-center gap-3 px-3 py-2 w-full text-slate-600 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 rounded-lg transition-colors"
        >
          <LogOut size={20} />
          {sidebarOpen && <span>Logout</span>}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
