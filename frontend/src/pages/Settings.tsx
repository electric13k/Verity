import React, { useState } from 'react';
import { Shield, Moon, Sun, Save, Info, Key } from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import { useAuthStore } from '../store/authStore';
import client from '../api/client';

const Settings: React.FC = () => {
  const { darkMode, toggleDarkMode } = useUIStore();
  const user = useAuthStore((state) => state.user);
  
  const [keys, setKeys] = useState({
    openai: '',
    claude: '',
    kimi: ''
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const handleSaveKeys = async () => {
    setSaving(true);
    setMessage('');
    try {
      if (keys.openai) await client.post('/connectors/openai/config', { apiKey: keys.openai });
      if (keys.claude) await client.post('/connectors/claude/config', { apiKey: keys.claude });
      if (keys.kimi) await client.post('/connectors/kimi/config', { apiKey: keys.kimi });
      setMessage('API keys updated successfully');
    } catch (err) {
      setMessage('Failed to update API keys');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Settings</h1>
        <p className="text-slate-500 dark:text-slate-400">Configure your orchestration environment</p>
      </div>

      {/* Account Section */}
      <section className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800 font-bold flex items-center gap-2">
          <Shield size={18} className="text-blue-600" /> Account Information
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-500 mb-1">Email Address</label>
            <p className="text-slate-900 dark:text-white font-medium">{user?.email}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-500 mb-1">User ID</label>
            <p className="text-xs font-mono text-slate-400">{user?.id}</p>
          </div>
        </div>
      </section>

      {/* Appearance Section */}
      <section className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800 font-bold flex items-center gap-2">
          {darkMode ? <Moon size={18} className="text-indigo-400" /> : <Sun size={18} className="text-yellow-500" />} 
          Appearance
        </div>
        <div className="p-6 flex items-center justify-between">
          <div>
            <p className="font-medium text-slate-900 dark:text-white">Dark Mode</p>
            <p className="text-sm text-slate-500">Adjust the interface for low-light environments</p>
          </div>
          <button
            onClick={toggleDarkMode}
            className={`w-12 h-6 rounded-full transition-colors relative ${darkMode ? 'bg-indigo-600' : 'bg-slate-200'}`}
          >
            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${darkMode ? 'left-7' : 'left-1'}`} />
          </button>
        </div>
      </section>

      {/* API Keys Section */}
      <section className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800 font-bold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key size={18} className="text-amber-500" /> API Keys
          </div>
          {message && <span className="text-xs font-medium text-green-600">{message}</span>}
        </div>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">OpenAI API Key</label>
              <input
                type="password"
                value={keys.openai}
                onChange={(e) => setKeys({ ...keys, openai: e.target.value })}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 transition-all dark:text-white"
                placeholder="sk-..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Anthropic API Key</label>
              <input
                type="password"
                value={keys.claude}
                onChange={(e) => setKeys({ ...keys, claude: e.target.value })}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 transition-all dark:text-white"
                placeholder="sk-ant-..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Moonshot (Kimi) Key</label>
              <input
                type="password"
                value={keys.kimi}
                onChange={(e) => setKeys({ ...keys, kimi: e.target.value })}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 transition-all dark:text-white"
                placeholder="sk-..."
              />
            </div>
          </div>
          <button
            onClick={handleSaveKeys}
            disabled={saving}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-lg shadow-indigo-500/30 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <Save size={18} /> {saving ? 'Saving...' : 'Save API Keys'}
          </button>
        </div>
      </section>

      {/* About Section */}
      <section className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800 font-bold flex items-center gap-2">
          <Info size={18} className="text-slate-500" /> About
        </div>
        <div className="p-6">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            AI Orchestrator v1.0.0
          </p>
          <p className="text-sm text-slate-500 mt-2">
            A production-grade local-first AI orchestration platform implementing H.C.T. reasoning frameworks.
          </p>
        </div>
      </section>
    </div>
  );
};

export default Settings;
