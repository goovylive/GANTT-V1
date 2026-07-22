import React from 'react';
import { Database } from 'lucide-react';

interface HeaderProps {
  lastUpdated: Date | null;
}

export default function Header({
  lastUpdated
}: HeaderProps) {
  return (
    <div className="flex justify-end items-center gap-4 mb-6" id="app-header">
      {lastUpdated && (
        <span className="text-[10px] text-slate-400 font-mono">
          Última actualización: {lastUpdated.toLocaleTimeString()}
        </span>
      )}
      {/* Status Badge */}
      <div className="flex items-center gap-1.5 bg-white text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 shadow-3xs">
        <Database className="w-4 h-4 text-slate-500" />
        <span>Conectado a Supabase</span>
      </div>
    </div>
  );
}
