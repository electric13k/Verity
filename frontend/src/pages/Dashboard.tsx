import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Puzzle, CheckCircle, Activity, ArrowRight, Clock } from 'lucide-react';
import client from '../api/client';
import { Task, Connector } from '../types';

const Dashboard: React.FC = () => {
  const { data: tasks } = useQuery<Task[]>({
    queryKey: ['tasks'],
    queryFn: async () => (await client.get('/tasks')).data
  });

  const { data: connectors } = useQuery<Connector[]>({
    queryKey: ['connectors'],
    queryFn: async () => (await client.get('/connectors')).data
  });

  const stats = [
    { 
      label: 'Active Connectors', 
      value: connectors?.filter(c => c.enabled).length || 0, 
      icon: Puzzle, 
      color: 'text-blue-600', 
      bg: 'bg-blue-50 dark:bg-blue-900/20' 
    },
    { 
      label: 'Total Tasks', 
      value: tasks?.length || 0, 
      icon: Activity, 
      color: 'text-indigo-600', 
      bg: 'bg-indigo-50 dark:bg-indigo-900/20' 
    },
    { 
      label: 'Completed', 
      value: tasks?.filter(t => t.status === 'completed').length || 0, 
      icon: CheckCircle, 
      color: 'text-green-600', 
      bg: 'bg-green-50 dark:bg-green-900/20' 
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Dashboard</h1>
          <p className="text-slate-500 dark:text-slate-400">Overview of your AI orchestration system</p>
        </div>
        <Link 
          to="/tasks" 
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2"
        >
          New Task <ArrowRight size={18} />
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-4">
            <div className={`w-12 h-12 ${stat.bg} ${stat.color} rounded-lg flex items-center justify-center`}>
              <stat.icon size={24} />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{stat.label}</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h3 className="font-bold text-slate-900 dark:text-white">Recent Tasks</h3>
          <Link to="/tasks" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">View all</Link>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {tasks?.slice(0, 5).map((task) => (
            <div key={task.id} className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
              <div className="flex items-center gap-4">
                <div className={`w-2 h-2 rounded-full ${
                  task.status === 'completed' ? 'bg-green-500' : 
                  task.status === 'failed' ? 'bg-red-500' : 'bg-yellow-500'
                }`} />
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">{task.title}</p>
                  <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                    <Clock size={12} />
                    {new Date(task.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>
              <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${
                task.status === 'completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 
                task.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 
                'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
              }`}>
                {task.status}
              </span>
            </div>
          ))}
          {(!tasks || tasks.length === 0) && (
            <div className="p-12 text-center">
              <p className="text-slate-500 dark:text-slate-400">No tasks found. Start by creating your first task.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
