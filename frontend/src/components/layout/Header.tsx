import React from 'react';
import { Menu, Sun, Moon } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';

const Header: React.FC = () => {
  const { toggleSidebar, darkMode, toggleDarkMode } = useUIStore();
  const user = useAuthStore((state) => state.user);

  return (
    <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-6 sticky top-0 z-10">
      <div className="flex items-center gap-4">
        <button 
          onClick={toggleSidebar}
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-400"
        >
          <Menu size={20} />
        </button>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">AI Orchestration Console</h2>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={toggleDarkMode}
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-400"
        >
          {darkMode ? <Sun size={20} /> : <Moon size={20} />}
        </button>
        <div className="h-8 w-px bg-slate-200 dark:border-slate-800 mx-2" />
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium text-slate-900 dark:text-white">{user?.email}</p>
            <p className="text-xs text-slate-500">Local User</p>
          </div>
          <div className="w-8 h-8 bg-slate-200 dark:bg-slate-700 rounded-full flex items-center justify-center text-slate-600 dark:text-slate-300 font-bold uppercase">
            {user?.email?.[0] || 'U'}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
