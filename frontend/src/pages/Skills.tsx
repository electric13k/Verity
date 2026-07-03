import React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Zap, Play, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import client from '../api/client';
import { Skill } from '../types';

const Skills: React.FC = () => {
  const { data: skills, isLoading } = useQuery<Skill[]>({
    queryKey: ['skills'],
    queryFn: async () => (await client.get('/skills')).data
  });

  const executeMutation = useMutation({
    mutationFn: async ({ id, input }: { id: string; input: string }) => {
      return (await client.post(`/skills/${id}/execute`, { input })).data;
    },
    onSuccess: (data) => {
      alert(data.result);
    },
    onError: (err: any) => {
      alert(`Error: ${err.response?.data?.error || err.message}`);
    }
  });

  if (isLoading) return (
    <div className="h-full flex items-center justify-center">
      <Loader2 className="animate-spin text-indigo-600" size={48} />
    </div>
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Skills</h1>
        <p className="text-slate-500 dark:text-slate-400">Reusable multi-step AI workflows</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {skills?.map((skill) => (
          <div key={skill.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 flex flex-col h-full transition-all hover:shadow-lg">
            <div className="flex items-start justify-between mb-4">
              <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg text-indigo-600 dark:text-indigo-400">
                <Zap size={24} />
              </div>
            </div>

            <div className="flex-1">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">{skill.name}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{skill.description}</p>
              
              <div className="space-y-2 mb-4">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Workflow Steps</p>
                <div className="space-y-1">
                  {skill.steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                      <div className="w-1 h-1 rounded-full bg-indigo-400" /> {step}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {skill.requiredConnectors.map(conn => (
                  <span key={conn} className="px-2 py-1 bg-slate-100 dark:bg-slate-800 text-[10px] rounded font-medium text-slate-600 dark:text-slate-400">
                    {conn}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
              <button 
                onClick={() => {
                  const input = prompt(`Enter input for ${skill.name}:`);
                  if (input) executeMutation.mutate({ id: skill.id, input });
                }}
                disabled={executeMutation.isPending}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
              >
                {executeMutation.isPending ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />}
                Run Skill
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Skills;
