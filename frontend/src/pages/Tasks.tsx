import React, { useState } from 'react';
import { Send, Loader2, CheckCircle, AlertCircle, Info, Database, Brain, Activity } from 'lucide-react';
import client from '../api/client';
import { ExecutionResult } from '../types';

const Tasks: React.FC = () => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [error, setError] = useState('');

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const response = await client.post('/tasks', { title, description });
      setResult(response.data.execution);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Execution failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Ask Verity</h1>
        <p className="text-slate-500 dark:text-slate-400">Verity assigns the right AI agents, checks their work, and merges it into one answer.</p>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0">
        {/* Input Panel */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 font-bold flex items-center gap-2">
            <Send size={18} className="text-indigo-600" /> Task Input
          </div>
          <form onSubmit={handleExecute} className="flex-1 flex flex-col p-6 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Task Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Market Research Analysis"
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white"
                required
              />
            </div>
            <div className="flex-1 flex flex-col">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Detailed Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe exactly what you want the AI orchestrator to do..."
                className="flex-1 w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white resize-none"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-matcha hover:bg-matcha/90 text-white font-semibold rounded-lg shadow-lg shadow-matcha/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50 glass-btn"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  Orchestrating Frameworks...
                </>
              ) : (
                <>
                  <Send size={20} />
                  Ask Verity
                </>
              )}
            </button>
          </form>
        </div>

        {/* Output Panel */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 font-bold flex items-center gap-2">
            <Activity size={18} className="text-green-600" /> Execution Result
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-4">
                <Loader2 className="animate-spin" size={48} />
                <p className="animate-pulse">Reasoning through H.C.T. layers...</p>
              </div>
            ) : result ? (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${
                    result.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {result.status}
                  </span>
                  <div className="flex gap-4 text-xs text-slate-500">
                    <span>Time: {result.executionTime}ms</span>
                    <span>Cost: ${result.totalCost.toFixed(4)}</span>
                  </div>
                </div>

                <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-100 dark:border-indigo-800/50">
                  <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-400 font-bold mb-2">
                    <Brain size={18} /> HAISB Interpretation
                  </div>
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Goal: {result.reasoning.objective}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {result.reasoning.successCriteria.map((c, i) => (
                      <span key={i} className="px-2 py-0.5 bg-white dark:bg-slate-800 text-[10px] rounded border border-indigo-100 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400">
                        ✓ {c}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300 font-bold mb-2">
                    <Database size={18} /> Selected Plan: {result.selectedPlan.name}
                  </div>
                  <ul className="text-sm space-y-1 text-slate-600 dark:text-slate-400">
                    {result.selectedPlan.steps.map((step: string, i: number) => (
                      <li key={i} className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-slate-400" /> {step}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-2">
                  <h4 className="font-bold text-slate-900 dark:text-white">Final Output</h4>
                  <div className="p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm leading-relaxed whitespace-pre-wrap">
                    {result.finalResult}
                  </div>
                </div>
              </div>
            ) : error ? (
              <div className="h-full flex flex-col items-center justify-center text-red-500 gap-4">
                <AlertCircle size={48} />
                <p className="font-medium">{error}</p>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-4 opacity-50">
                <Info size={48} />
                <p>Execution trace will appear here</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Tasks;
