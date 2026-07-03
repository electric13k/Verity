import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Puzzle, Check, X, Shield, Cpu, Globe, ExternalLink } from 'lucide-react';
import client from '../api/client';
import { Connector } from '../types';

const ConnectorCard: React.FC<{ connector: Connector }> = ({ connector }) => {
  const queryClient = useQueryClient();
  
  const toggleMutation = useMutation({
    mutationFn: async () => {
      const action = connector.enabled ? 'disable' : 'enable';
      return (await client.post(`/connectors/${connector.id}/${action}`)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
    }
  });

  const getIcon = () => {
    switch (connector.type) {
      case 'llm': return <Brain className="text-purple-600" size={24} />;
      case 'tool': return <Cpu className="text-blue-600" size={24} />;
      case 'data': return <Globe className="text-green-600" size={24} />;
      default: return <Puzzle className="text-slate-600" size={24} />;
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 flex flex-col h-full transition-all hover:shadow-lg">
      <div className="flex items-start justify-between mb-4">
        <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
          {getIcon()}
        </div>
        <button
          onClick={() => toggleMutation.mutate()}
          disabled={toggleMutation.isPending}
          className={`px-3 py-1 rounded-full text-xs font-bold uppercase flex items-center gap-1 transition-colors ${
            connector.enabled 
              ? 'bg-green-100 text-green-700 hover:bg-green-200' 
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          {connector.enabled ? <><Check size={14} /> Enabled</> : <><X size={14} /> Disabled</>}
        </button>
      </div>

      <div className="flex-1">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">{connector.name}</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{connector.description}</p>
        
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Type</span>
            <span className="font-medium uppercase">{connector.type}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Cost/Call</span>
            <span className="font-medium">${connector.costPerCall.toFixed(3)}</span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {connector.metadata.capabilities.map(cap => (
            <span key={cap} className="px-2 py-1 bg-slate-100 dark:bg-slate-800 text-[10px] rounded font-medium text-slate-600 dark:text-slate-400">
              {cap}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
        <button className="text-sm text-indigo-600 dark:text-indigo-400 font-medium flex items-center gap-1 hover:underline">
          Configure <ExternalLink size={14} />
        </button>
      </div>
    </div>
  );
};

// Helper components for the icons used in ConnectorCard
const Brain = ({ className, size }: { className?: string, size?: number }) => <Puzzle className={className} size={size} />;

const Connectors: React.FC = () => {
  const { data: connectors, isLoading } = useQuery<Connector[]>({
    queryKey: ['connectors'],
    queryFn: async () => (await client.get('/connectors')).data
  });

  const categories = [
    { id: 'llm', name: 'Language Models', icon: Brain },
    { id: 'tool', name: 'System Tools', icon: Cpu },
    { id: 'data', name: 'Data Sources', icon: Globe },
  ];

  if (isLoading) return (
    <div className="h-full flex items-center justify-center">
      <Loader2 className="animate-spin text-indigo-600" size={48} />
    </div>
  );

  return (
    <div className="space-y-12">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Connectors</h1>
        <p className="text-slate-500 dark:text-slate-400">Manage your AI providers and local system integrations</p>
      </div>

      {categories.map(cat => (
        <section key={cat.id} className="space-y-6">
          <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-800 pb-2">
            <cat.icon className="text-indigo-600" size={24} />
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">{cat.name}</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {connectors?.filter(c => c.type === cat.id).map(c => (
              <ConnectorCard key={c.id} connector={c} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

const Loader2 = ({ className, size }: { className?: string, size?: number }) => (
  <svg 
    className={className} 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round"
  >
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

export default Connectors;
