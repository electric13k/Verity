import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Server, Play, Square, Plus, Loader2, AlertCircle } from 'lucide-react';
import client from '../api/client';

const MCP: React.FC = () => {
  const queryClient = useQueryClient();
  const [newServer, setNewServer] = useState({ id: '', name: '', command: '', args: '' });

  const { data: servers, isLoading } = useQuery<string[]>({
    queryKey: ['mcp-servers'],
    queryFn: async () => (await client.get('/mcp/servers')).data
  });

  const startMutation = useMutation({
    mutationFn: async (config: any) => (await client.post('/mcp/servers/start', config)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mcp-servers'] })
  });

  const stopMutation = useMutation({
    mutationFn: async (id: string) => (await client.post(`/mcp/servers/${id}/stop`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mcp-servers'] })
  });

  if (isLoading) return (
    <div className="h-full flex items-center justify-center">
      <Loader2 className="animate-spin text-indigo-600" size={48} />
    </div>
  );

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">MCP Servers</h1>
          <p className="text-slate-500 dark:text-slate-400">Manage Model Context Protocol servers</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Active Servers */}
        <div className="lg:col-span-2 space-y-6">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Server size={20} className="text-indigo-600" /> Active Servers
          </h2>
          <div className="grid grid-cols-1 gap-4">
            {servers?.map((id) => (
              <div key={id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-green-100 dark:bg-green-900/20 text-green-600 rounded-full flex items-center justify-center">
                    <Server size={20} />
                  </div>
                  <div>
                    <p className="font-bold text-slate-900 dark:text-white">{id}</p>
                    <p className="text-xs text-green-500 font-medium uppercase">Running</p>
                  </div>
                </div>
                <button 
                  onClick={() => stopMutation.mutate(id)}
                  className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                >
                  <Square size={20} />
                </button>
              </div>
            ))}
            {(!servers || servers.length === 0) && (
              <div className="p-12 text-center bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
                <p className="text-slate-500 dark:text-slate-400">No active MCP servers found.</p>
              </div>
            )}
          </div>
        </div>

        {/* Add New Server */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 h-fit space-y-6">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Plus size={20} className="text-indigo-600" /> Add Server
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Server ID</label>
              <input 
                type="text" 
                value={newServer.id}
                onChange={(e) => setNewServer({ ...newServer, id: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                placeholder="e.g., weather-mcp"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Display Name</label>
              <input 
                type="text" 
                value={newServer.name}
                onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                placeholder="e.g., Weather MCP Server"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Command</label>
              <input 
                type="text" 
                value={newServer.command}
                onChange={(e) => setNewServer({ ...newServer, command: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                placeholder="e.g., npx"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Arguments (comma separated)</label>
              <input 
                type="text" 
                value={newServer.args}
                onChange={(e) => setNewServer({ ...newServer, args: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                placeholder="e.g., -y, @modelcontextprotocol/server-everything"
              />
            </div>
            <button 
              onClick={() => startMutation.mutate({
                ...newServer,
                args: newServer.args.split(',').map(s => s.trim())
              })}
              disabled={startMutation.isPending}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
            >
              {startMutation.isPending ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />}
              Start Server
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MCP;
