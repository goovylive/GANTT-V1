import React, { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, Layers, Database, Sparkles, RefreshCw, AlertTriangle, BarChart2, Play, Pause } from 'lucide-react';
import {
  getSupabaseClient,
  isSupabaseConfigured,
  IdentificacionTarea,
  RegistroTiempos,
  ExcepcionLaboral,
  LoteCargado
} from './supabaseClient';

import Header from './components/Header';
import LoteSelector from './components/LoteSelector';
import GanttChart from './components/GanttChart';
import ExceptionsCalendar from './components/ExceptionsCalendar';
import DataAnalysis from './components/DataAnalysis';
import DataAnalysisStops from './components/DataAnalysisStops';
import DataAnalysisTotal from './components/DataAnalysisTotal';


export default function App() {
  const hasInitializedFromDb = useRef<boolean>(false);
  const [tareas, setTareas] = useState<IdentificacionTarea[]>([]);
  const [registroTiempos, setRegistroTiempos] = useState<RegistroTiempos[]>([]);
  const [exceptions, setExceptions] = useState<ExcepcionLaboral[]>([]);
  const [lotesCargados, setLotesCargados] = useState<LoteCargado[]>([]);
  
  const [allLotes, setAllLotes] = useState<string[]>([]);
  const [selectedLotes, setSelectedLotes] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');
  
  const [view, setView] = useState<'gantt' | 'analysis' | 'analysis-stops' | 'analysis-total'>('gantt');
  const [checkedLotes, setCheckedLotes] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState<boolean>(false);
  const [ganttDateRange, setGanttDateRange] = useState<{ min: Date; max: Date } | null>(null);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState<boolean>(false);

  // Shared Analysis Product/Category Selection States
  const [analysisMainTab, setAnalysisMainTab] = useState<'ESTÉRILES' | 'NO ESTÉRILES'>('NO ESTÉRILES');
  const [analysisSelectedEsterilesCodes, setAnalysisSelectedEsterilesCodes] = useState<string[]>([]);
  const [analysisSelectedNoEsterilesCodes, setAnalysisSelectedNoEsterilesCodes] = useState<string[]>([]);
  const [analysisActiveEsterilTab, setAnalysisActiveEsterilTab] = useState<string>('');
  const [analysisActiveNoEsterilTab, setAnalysisActiveNoEsterilTab] = useState<string>('');
  const [analysisIsEsterilesInitialized, setAnalysisIsEsterilesInitialized] = useState(false);
  const [analysisIsNoEsterilesInitialized, setAnalysisIsNoEsterilesInitialized] = useState(false);
  const [isDbInitialized, setIsDbInitialized] = useState(false);

  // Core Data Fetcher
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    
    const supabase = getSupabaseClient();
    
    if (!supabase) {
      setErrorMsg("El cliente de Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.");
      setIsLoading(false);
      return;
    }

    const anySupabase = supabase as any;
    try {
      // Helper function to paginate and fetch all rows from a table to bypass the 1000-record limit
      const fetchAllRows = async (tableName: string, orderCol1: string, orderCol2?: string) => {
        let allData: any[] = [];
        let page = 0;
        const pageSize = 1000;
        let hasMore = true;

        while (hasMore) {
          let query = anySupabase
            .from(tableName)
            .select('*')
            .range(page * pageSize, (page + 1) * pageSize - 1);
          
          if (orderCol2) {
            query = query
              .order(orderCol1, { ascending: true })
              .order(orderCol2, { ascending: true });
          } else {
            query = query.order(orderCol1, { ascending: true });
          }

          const { data, error } = await query;
          if (error) throw error;

          if (data && data.length > 0) {
            allData = [...allData, ...data];
          }

          if (!data || data.length < pageSize) {
            hasMore = false;
          } else {
            page++;
          }
        }
        return allData;
      };

      // Fetch Subprocesses ordered by no_paso using pagination
      const tData = await fetchAllRows('identificacion_tarea_2', 'no_paso');

      // Fetch Timestamps ordered by id_t and secuencia using pagination
      const rtData = await fetchAllRows('registro_tiempos_2', 'id_t', 'secuencia');

      // Fetch Exceptions Calendar
      const { data: exData, error: exErr } = await anySupabase
        .from('excepciones_laborales')
        .select('*');
        
      if (exErr) throw exErr;

      // Fetch loaded batches (lotes_cargados)
      const { data: lcData, error: lcErr } = await anySupabase
        .from('lotes_cargados')
        .select('nro_lote, producto');
      
      if (lcErr) {
        console.warn('Error fetching lotes_cargados table:', lcErr);
      }

      // Set live DB state
      setTareas(tData || []);
      setRegistroTiempos(rtData || []);
      setExceptions(exData || []);
      setLotesCargados(lcData || []);

      // Compute unique batches available
      const lotes = Array.from(new Set((tData || []).map((t) => t.nro_lote)))
        .filter(Boolean)
        .sort();
      setAllLotes(lotes);

      // Build valid lote set and product set for checking
      const validLoteSet = new Set<string>();
      lotes.forEach((l: any) => validLoteSet.add(String(l).trim()));
      (tData || []).forEach((t: any) => { if (t.nro_lote) validLoteSet.add(String(t.nro_lote).trim()); });
      if (lcData) {
        lcData.forEach((l: any) => { if (l.nro_lote) validLoteSet.add(String(l.nro_lote).trim()); });
      }

      const validProductCodes = new Set<string>();
      (tData || []).forEach((t: any) => { if (t.id_prd_lin) validProductCodes.add(String(t.id_prd_lin).trim()); });

      // Fetch user's active selection/view from Supabase table 'seleccion_activa' only on initial load
      let restoredGanttLotes: string[] = [];
      if (!hasInitializedFromDb.current) {
        let restoredCheckedLotes = false;
        try {
          const { data: selData, error: selErr } = await anySupabase
            .from('seleccion_activa')
            .select('*')
            .eq('id', 1)
            .maybeSingle();

          if (selErr) {
            console.warn('Error fetching table seleccion_activa:', selErr);
          } else if (selData) {
            // 1. Restore view if valid
            const validViews = ['gantt', 'analysis', 'analysis-stops', 'analysis-total'];
            if (selData.vista_activa && validViews.includes(selData.vista_activa)) {
              setView(selData.vista_activa);
            }

            // 2. Restore checked_lotes if valid (for analysis views)
            if (Array.isArray(selData.checked_lotes) && selData.checked_lotes.length > 0) {
              const lowerToOriginal = new Map<string, string>();
              validLoteSet.forEach(l => {
                lowerToOriginal.set(l.toLowerCase().trim(), l);
              });

              const filteredLotes = selData.checked_lotes
                .map((l: string) => lowerToOriginal.get(String(l).toLowerCase().trim()))
                .filter((l): l is string => l !== undefined);

              if (filteredLotes.length > 0) {
                const nextChecked: Record<string, boolean> = {};
                filteredLotes.forEach((l: string) => {
                  nextChecked[l] = true;
                });
                // Set all other valid lotes to false explicitly so they aren't auto-checked by component effects
                validLoteSet.forEach(l => {
                  if (!nextChecked[l]) {
                    nextChecked[l] = false;
                  }
                });
                setCheckedLotes(nextChecked);
                restoredCheckedLotes = true;
              }
            }

            // 3. Restore Gantt states (gantt_lote & gantt_checked_lotes)
            if (selData.gantt_lote && validLoteSet.has(selData.gantt_lote.trim())) {
              setActiveTab(selData.gantt_lote.trim());
            }
            if (Array.isArray(selData.gantt_checked_lotes) && selData.gantt_checked_lotes.length > 0) {
              const filteredGanttLotes = selData.gantt_checked_lotes.filter((l: string) => validLoteSet.has(l.trim()));
              if (filteredGanttLotes.length > 0) {
                setSelectedLotes(filteredGanttLotes);
                restoredGanttLotes = filteredGanttLotes;
              }
            }

            // 4. Restore Analysis main tab if valid
            if (selData.analysis_main_tab === 'ESTÉRILES' || selData.analysis_main_tab === 'NO ESTÉRILES') {
              setAnalysisMainTab(selData.analysis_main_tab);
            }

            // 5. Restore Analysis Esteriles product if valid
            const savedEsterilCode = selData.analysis_esteril_producto ? selData.analysis_esteril_producto.trim() : null;
            if (savedEsterilCode) {
              if (savedEsterilCode.includes(';')) {
                const [activeEsteril, codesStr] = savedEsterilCode.split(';');
                const codes = codesStr ? codesStr.split(',').map(c => c.trim()).filter(c => validProductCodes.has(c)) : [];
                if (codes.length > 0) {
                  setAnalysisSelectedEsterilesCodes(codes);
                  setAnalysisActiveEsterilTab(activeEsteril && validProductCodes.has(activeEsteril.trim()) ? activeEsteril.trim() : codes[0]);
                  setAnalysisIsEsterilesInitialized(true);
                }
              } else if (validProductCodes.has(savedEsterilCode)) {
                setAnalysisSelectedEsterilesCodes([savedEsterilCode]);
                setAnalysisActiveEsterilTab(savedEsterilCode);
                setAnalysisIsEsterilesInitialized(true);
              }
            }

            // 6. Restore Analysis No Esteriles product if valid
            const savedNoEsterilCode = selData.analysis_no_esteril_producto ? selData.analysis_no_esteril_producto.trim() : null;
            if (savedNoEsterilCode) {
              if (savedNoEsterilCode.includes(';')) {
                const [activeNoEsteril, codesStr] = savedNoEsterilCode.split(';');
                const codes = codesStr ? codesStr.split(',').map(c => c.trim()).filter(c => validProductCodes.has(c)) : [];
                if (codes.length > 0) {
                  setAnalysisSelectedNoEsterilesCodes(codes);
                  setAnalysisActiveNoEsterilTab(activeNoEsteril && validProductCodes.has(activeNoEsteril.trim()) ? activeNoEsteril.trim() : codes[0]);
                  setAnalysisIsNoEsterilesInitialized(true);
                }
              } else if (validProductCodes.has(savedNoEsterilCode)) {
                setAnalysisSelectedNoEsterilesCodes([savedNoEsterilCode]);
                setAnalysisActiveNoEsterilTab(savedNoEsterilCode);
                setAnalysisIsNoEsterilesInitialized(true);
              }
            }
          }
        } catch (selEx) {
          console.warn('Gracefully handling seleccion_activa loading exception:', selEx);
        }

        // If no checked_lotes were restored, default them all to true
        if (!restoredCheckedLotes) {
          const defaultChecked: Record<string, boolean> = {};
          validLoteSet.forEach(l => {
            defaultChecked[l] = true;
          });
          setCheckedLotes(defaultChecked);
        }

        // Enable state synchronization only after a 1.5 seconds settling window
        // to prevent startup cascades or default values from overwriting the loaded DB selections
        setTimeout(() => {
          hasInitializedFromDb.current = true;
          setIsDbInitialized(true);
        }, 1500);
      }

      // Auto-select first batch if absolutely none were restored and none selected yet
      if (restoredGanttLotes.length === 0 && selectedLotes.length === 0 && lotes.length > 0) {
        setSelectedLotes([lotes[0]]);
        setActiveTab(lotes[0]);
      }
      
    } catch (err: any) {
      console.error('Error fetching Supabase data:', err);
      setErrorMsg(`Error al conectar con las tablas de Supabase: ${err.message || err}`);
      setTareas([]);
      setRegistroTiempos([]);
      setExceptions([]);
      setAllLotes([]);
    }
    
    setLastUpdated(new Date());
    setIsLoading(false);
  }, [selectedLotes.length]);

  // Initial Fetch & Refresh logic
  useEffect(() => {
    fetchData();
  }, []);

  // Autorefresh countdown state
  const [autoRefreshIntervalSeconds, setAutoRefreshIntervalSeconds] = useState<number>(300); // 5 minutes default (300 seconds)
  const [secondsLeft, setSecondsLeft] = useState<number>(autoRefreshIntervalSeconds);
  const [isAutoRefreshPlaying, setIsAutoRefreshPlaying] = useState<boolean>(true);

  useEffect(() => {
    setSecondsLeft(autoRefreshIntervalSeconds);
  }, [lastUpdated, autoRefreshIntervalSeconds]);

  useEffect(() => {
    if (!isAutoRefreshPlaying) return;

    const timer = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setTimeout(() => {
            fetchData();
          }, 0);
          return autoRefreshIntervalSeconds;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [fetchData, isAutoRefreshPlaying, autoRefreshIntervalSeconds]);

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Update active tab when selection changes to make sure active tab is always valid
  useEffect(() => {
    if (hasInitializedFromDb.current && selectedLotes.length > 0 && !selectedLotes.includes(activeTab)) {
      setActiveTab(selectedLotes[0]);
    }
  }, [selectedLotes, activeTab]);

  // Synchronize state changes back to Supabase 'seleccion_activa'
  useEffect(() => {
    // Only write if initial DB load has completed successfully
    if (!hasInitializedFromDb.current) return;

    const syncState = async () => {
      const supabase = getSupabaseClient();
      if (!supabase) return;

      const checkedLotesArray = Object.keys(checkedLotes).filter(key => checkedLotes[key] === true);

      try {
        const { error } = await (supabase as any)
          .from('seleccion_activa')
          .update({
            vista_activa: view,
            gantt_lote: activeTab || null,
            gantt_checked_lotes: selectedLotes,
            analysis_main_tab: analysisMainTab,
            analysis_esteril_producto: analysisSelectedEsterilesCodes.length > 0 
              ? `${analysisActiveEsterilTab || ''};${analysisSelectedEsterilesCodes.join(',')}`
              : (analysisActiveEsterilTab || null),
            analysis_no_esteril_producto: analysisSelectedNoEsterilesCodes.length > 0
              ? `${analysisActiveNoEsterilTab || ''};${analysisSelectedNoEsterilesCodes.join(',')}`
              : (analysisActiveNoEsterilTab || null),
            checked_lotes: checkedLotesArray,
            updated_at: new Date().toISOString()
          })
          .eq('id', 1);

        if (error) {
          console.error('Error updating seleccion_activa in Supabase:', error);
        }
      } catch (err) {
        console.error('Error synchronizing selection state to Supabase:', err);
      }
    };

    // Debounce database sync to avoid rapid updates (e.g., when clicking multiple checkboxes quickly)
    const timer = setTimeout(() => {
      syncState();
    }, 500);

    return () => clearTimeout(timer);
  }, [
    view,
    activeTab,
    selectedLotes,
    analysisMainTab,
    analysisActiveEsterilTab,
    analysisActiveNoEsterilTab,
    analysisSelectedEsterilesCodes,
    analysisSelectedNoEsterilesCodes,
    checkedLotes
  ]);

  // Calendar Exceptions Modifier logic
  const handleToggleException = async (fecha: string, newEsLaboral: boolean) => {
    setIsLoading(true);
    const supabase = getSupabaseClient();
    
    // Check default state for this date's day of week
    // Sunday (0) = false (non-working), Monday-Saturday (1-6) = true (working)
    const dateParts = fecha.split('-');
    const dateObj = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]));
    const defaultStatus = dateObj.getDay() !== 0;

    // Local state preview update for snappy response
    const updatedExceptions = [...exceptions];
    const existingIndex = updatedExceptions.findIndex((ex) => ex.fecha === fecha);

    if (newEsLaboral === defaultStatus) {
      // If matches default, delete exceptions
      if (existingIndex > -1) {
        updatedExceptions.splice(existingIndex, 1);
      }
      
      if (isSupabaseConfigured && supabase) {
        try {
          const { error } = await (supabase as any)
            .from('excepciones_laborales')
            .delete()
            .eq('fecha', fecha);
            
          if (error) throw error;
        } catch (err: any) {
          console.error('Error deleting exception from Supabase:', err);
          alert(`No se pudo eliminar la excepción en Supabase: ${err.message}`);
        }
      }
    } else {
      // If differs from default, upsert exception
      if (existingIndex > -1) {
        updatedExceptions[existingIndex].es_laboral = newEsLaboral;
      } else {
        updatedExceptions.push({ fecha, es_laboral: newEsLaboral });
      }

      if (isSupabaseConfigured && supabase) {
        try {
          const { error } = await (supabase as any)
            .from('excepciones_laborales')
            .upsert({ fecha, es_laboral: newEsLaboral });
            
          if (error) throw error;
        } catch (err: any) {
          console.error('Error saving exception to Supabase:', err);
          alert(`No se pudo guardar la excepción en Supabase: ${err.message}`);
        }
      }
    }

    setExceptions(updatedExceptions);
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-12" id="app-root">
      {/* Max container constraint (expanded to max-w-full to leverage full horizontal space) */}
      <div className="w-full max-w-[98%] mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        
        {/* Dynamic header */}
        <Header
          lastUpdated={lastUpdated}
        />

        {/* Database Warning Alert */}
        {errorMsg && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 bg-amber-50 border border-amber-200 text-amber-950 rounded-xl flex items-start gap-3"
            id="error-banner"
          >
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-sm">Advertencia de Conectividad</p>
              <p className="text-xs text-amber-800 mt-1 font-medium">{errorMsg}</p>
            </div>
          </motion.div>
        )}

        {/* Main Split Layout: Left Navigation & Right Module View */}
        <div className="flex flex-col lg:flex-row gap-6">
          
          {/* Left Navigation Sidebar Panel */}
          <div className={`w-full transition-all duration-300 ease-in-out shrink-0 ${isSidebarExpanded ? 'lg:w-64' : 'lg:w-[72px]'}`}>
            <div className={`bg-white border border-slate-200 rounded-xl p-3 shadow-3xs sticky top-6 transition-all duration-300 ease-in-out ${
              isSidebarExpanded ? 'space-y-1.5' : 'space-y-2'
            }`}>
              
              {/* Header with hamburger toggle */}
              <div className={`flex items-center ${isSidebarExpanded ? 'justify-between px-3 py-1.5 mb-2' : 'justify-center py-1.5 mb-1'}`}>
                {isSidebarExpanded && (
                  <span className="text-[9.5px] font-black text-slate-400 uppercase tracking-widest select-none">
                    NAVEGACIÓN
                  </span>
                )}
                <button
                  onClick={() => setIsSidebarExpanded(!isSidebarExpanded)}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-900 transition-all cursor-pointer"
                  title={isSidebarExpanded ? "Colapsar menú" : "Expandir menú"}
                  id="sidebar-toggle-btn"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
              </div>
              
              {/* Gantt Button */}
              <button
                onClick={() => setView('gantt')}
                className={`w-full flex items-center rounded-lg text-xs font-bold transition-all cursor-pointer select-none ${
                  isSidebarExpanded ? 'px-4 py-3 gap-3 justify-start' : 'p-3 justify-center'
                } ${
                  view === 'gantt'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
                id="nav-gantt"
                title="DIAGRAMA DE GANTT"
              >
                <Layers className="w-4 h-4 shrink-0" />
                {isSidebarExpanded && <span>DIAGRAMA DE GANTT</span>}
              </button>

              {/* Data Analysis Button (ANÁLISIS OPERACIÓN) */}
              <button
                onClick={() => setView('analysis')}
                className={`w-full flex items-center rounded-lg text-xs font-bold transition-all cursor-pointer select-none ${
                  isSidebarExpanded ? 'px-4 py-3 gap-3 justify-start' : 'p-3 justify-center'
                } ${
                  view === 'analysis'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
                id="nav-analysis"
                title="ANÁLISIS OPERACIÓN"
              >
                <BarChart2 className="w-4 h-4 shrink-0 text-emerald-500" />
                {isSidebarExpanded && <span>ANÁLISIS OPERACIÓN</span>}
              </button>

              {/* Data Analysis Stops Button (ANÁLISIS - PARADAS) */}
              <button
                onClick={() => setView('analysis-stops')}
                className={`w-full flex items-center rounded-lg text-xs font-bold transition-all cursor-pointer select-none ${
                  isSidebarExpanded ? 'px-4 py-3 gap-3 justify-start' : 'p-3 justify-center'
                } ${
                  view === 'analysis-stops'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
                id="nav-analysis-stops"
                title="ANÁLISIS - PARADAS"
              >
                <BarChart2 className="w-4 h-4 shrink-0 text-rose-500" />
                {isSidebarExpanded && <span>ANÁLISIS - PARADAS</span>}
              </button>

              {/* Data Analysis Total Button (ANÁLISIS SUBPROCESOS) */}
              <button
                onClick={() => setView('analysis-total')}
                className={`w-full flex items-center rounded-lg text-xs font-bold transition-all cursor-pointer select-none ${
                  isSidebarExpanded ? 'px-4 py-3 gap-3 justify-start' : 'p-3 justify-center'
                } ${
                  view === 'analysis-total'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
                id="nav-analysis-total"
                title="ANÁLISIS SUBPROCESOS"
              >
                <BarChart2 className="w-4 h-4 shrink-0 text-blue-900" />
                {isSidebarExpanded && <span>ANÁLISIS SUBPROCESOS</span>}
              </button>

              {/* Divider */}
              <div className="border-t border-slate-100 my-3" />
              
              {/* Autorefresh Block */}
              {isSidebarExpanded ? (
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 flex flex-col gap-2">
                  <div className="flex justify-between items-center px-1">
                    <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold font-mono">Autorefresco</span>
                    <span className={`text-xs font-mono font-semibold flex items-center gap-1 ${
                      isAutoRefreshPlaying ? 'text-slate-700' : 'text-amber-600'
                    }`}>
                      {!isAutoRefreshPlaying && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />}
                      {formatTime(secondsLeft)}
                    </span>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={fetchData}
                      disabled={isLoading}
                      className="flex-1 bg-slate-900 hover:bg-slate-800 text-white py-2 px-2.5 rounded-lg border border-transparent transition-all shadow-xs active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1 text-xs font-semibold cursor-pointer"
                      title="Refrescar datos ahora"
                      id="sidebar-refresh-button"
                    >
                      <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                      <span>Actualizar</span>
                    </button>
                    <button
                      onClick={() => setIsAutoRefreshPlaying(!isAutoRefreshPlaying)}
                      className={`p-2 rounded-lg border transition-all active:scale-95 flex items-center justify-center cursor-pointer ${
                        isAutoRefreshPlaying
                          ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                      }`}
                      title={isAutoRefreshPlaying ? "Pausar autorefresco" : "Reanudar autorefresco"}
                      id="autorefresh-play-pause-btn"
                    >
                      {isAutoRefreshPlaying ? (
                        <Pause className="w-3.5 h-3.5" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 justify-between px-1 mt-0.5 pt-1.5 border-t border-slate-200/60">
                    <span className="text-[10px] text-slate-500 font-medium">Intervalo:</span>
                    <select
                      value={autoRefreshIntervalSeconds}
                      onChange={(e) => setAutoRefreshIntervalSeconds(Number(e.target.value))}
                      className="bg-white border border-slate-200 text-slate-700 rounded-md text-[10.5px] font-medium py-0.5 px-1.5 focus:outline-hidden focus:ring-1 focus:ring-slate-400 cursor-pointer"
                      id="autorefresh-interval-select"
                    >
                      <option value={30}>30 seg</option>
                      <option value={60}>1 min</option>
                      <option value={180}>3 min</option>
                      <option value={300}>5 min</option>
                    </select>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1.5">
                  <button
                    onClick={fetchData}
                    disabled={isLoading}
                    className="p-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg border border-slate-200 transition-all shadow-3xs active:scale-95 disabled:opacity-50 flex items-center justify-center cursor-pointer"
                    title={`Autorefresco en ${formatTime(secondsLeft)}. Haz clic para actualizar ahora.`}
                    id="sidebar-refresh-button"
                  >
                    <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                  </button>
                  <button
                    onClick={() => setIsAutoRefreshPlaying(!isAutoRefreshPlaying)}
                    className={`p-1.5 rounded-md transition-all cursor-pointer ${
                      isAutoRefreshPlaying 
                        ? 'text-amber-600 hover:bg-amber-50' 
                        : 'text-emerald-600 hover:bg-emerald-50'
                    }`}
                    title={isAutoRefreshPlaying ? "Pausar autorefresco" : "Reanudar autorefresco"}
                    id="autorefresh-play-pause-collapsed-btn"
                  >
                    {isAutoRefreshPlaying ? (
                      <Pause className="w-3.5 h-3.5" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <span className={`text-[10px] font-mono font-bold leading-none select-none ${
                    isAutoRefreshPlaying ? 'text-slate-500' : 'text-amber-600 line-through'
                  }`}>
                    {formatTime(secondsLeft)}
                  </span>
                  <select
                    value={autoRefreshIntervalSeconds}
                    onChange={(e) => setAutoRefreshIntervalSeconds(Number(e.target.value))}
                    className="bg-white border border-slate-200 text-slate-700 rounded-md text-[9px] py-0.5 px-0.5 font-mono focus:outline-hidden focus:ring-1 focus:ring-slate-400 cursor-pointer text-center w-11 mt-0.5"
                    id="autorefresh-interval-collapsed-select"
                    title="Intervalo de autorefresco"
                  >
                    <option value={30}>30s</option>
                    <option value={60}>1m</option>
                    <option value={180}>3m</option>
                    <option value={300}>5m</option>
                  </select>
                </div>
              )}

            </div>
          </div>

          {/* Right Main Content Panel */}
          <div className="flex-1 min-w-0">
            {view === 'gantt' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Main Visualizer */}
                <div className={`${isCalendarOpen ? 'lg:col-span-2' : 'lg:col-span-3'} space-y-6`}>
                  {/* Batch Selector Widget */}
                  <LoteSelector
                    allLotes={allLotes}
                    selectedLotes={selectedLotes}
                    onChange={setSelectedLotes}
                    isLoading={isLoading}
                    lotesCargados={lotesCargados}
                    tareas={tareas}
                    isCalendarOpen={isCalendarOpen}
                    onToggleCalendar={() => setIsCalendarOpen(!isCalendarOpen)}
                  />

                  {/* Gantt Display Arena */}
                  <div className="space-y-4">
                    {selectedLotes.length === 0 ? (
                      <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-400">
                        <div className="p-3 bg-slate-100 text-slate-700 rounded-full inline-block mb-3">
                          <Layers className="w-8 h-8" />
                        </div>
                        <h4 className="font-bold text-slate-800 text-sm">Sin lotes seleccionados</h4>
                        <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto font-medium">
                          Por favor, selecciona uno o más de los lotes de la sección superior para visualizar su diagrama de Gantt en tiempo real.
                        </p>
                      </div>
                    ) : (
                      <div>
                        {/* Dynamic Tab Bar for Multiple Batches */}
                        {selectedLotes.length > 1 && (
                          <div className="flex bg-white px-6 border border-slate-200 border-b-0 rounded-t-xl gap-2 overflow-x-auto scrollbar-elegant mb-0" id="tabs-bar">
                            {selectedLotes.map((lote) => {
                              const isActive = activeTab === lote;
                              return (
                                <button
                                  key={lote}
                                  onClick={() => setActiveTab(lote)}
                                  id={`tab-button-${lote}`}
                                  className={`px-5 py-3.5 border-b-2 text-xs font-bold transition-all cursor-pointer whitespace-nowrap relative ${
                                    isActive
                                      ? 'border-slate-900 text-slate-900'
                                      : 'border-transparent text-slate-400 hover:text-slate-600'
                                  }`}
                                >
                                  <span>Lote {lote}</span>
                                  {isActive && (
                                    <motion.div
                                      layoutId="active-tab-line"
                                      className="absolute bottom-0 left-0 right-0 h-[2px] bg-slate-900"
                                    />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* Render Chart Content with Smooth Transitions */}
                        <AnimatePresence mode="wait">
                          {activeTab && (
                            <motion.div
                              key={activeTab}
                              initial={{ opacity: 0, x: 5 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: -5 }}
                              transition={{ duration: 0.15 }}
                            >
                              <GanttChart
                                lote={activeTab}
                                tareas={tareas}
                                registroTiempos={registroTiempos}
                                exceptions={exceptions}
                                onDateRangeChange={setGanttDateRange}
                                lotesCargados={lotesCargados}
                              />
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}
                  </div>
                </div>

                {/* Sidebar Area: Calendar (Right side) - Conditionally rendered */}
                {isCalendarOpen && (
                  <div className="lg:col-span-1">
                    <ExceptionsCalendar
                      exceptions={exceptions}
                      onToggleException={handleToggleException}
                      isLoading={isLoading}
                      ganttDateRange={ganttDateRange}
                      activeLote={activeTab}
                    />
                  </div>
                )}
              </div>
            )}

            <div className={view === 'analysis' ? 'block' : 'hidden'}>
              <DataAnalysis
                tareas={tareas}
                registroTiempos={registroTiempos}
                lotesCargados={lotesCargados}
                checkedLotes={checkedLotes}
                setCheckedLotes={setCheckedLotes}
                mainTab={analysisMainTab}
                setMainTab={setAnalysisMainTab}
                selectedEsterilesCodes={analysisSelectedEsterilesCodes}
                setSelectedEsterilesCodes={setAnalysisSelectedEsterilesCodes}
                selectedNoEsterilesCodes={analysisSelectedNoEsterilesCodes}
                setSelectedNoEsterilesCodes={setAnalysisSelectedNoEsterilesCodes}
                activeEsterilTab={analysisActiveEsterilTab}
                setActiveEsterilTab={setAnalysisActiveEsterilTab}
                activeNoEsterilTab={analysisActiveNoEsterilTab}
                setActiveNoEsterilTab={setAnalysisActiveNoEsterilTab}
                isEsterilesInitialized={analysisIsEsterilesInitialized}
                setIsEsterilesInitialized={setAnalysisIsEsterilesInitialized}
                isNoEsterilesInitialized={analysisIsNoEsterilesInitialized}
                setIsNoEsterilesInitialized={setAnalysisIsNoEsterilesInitialized}
                isDbInitialized={isDbInitialized}
              />
            </div>
            <div className={view === 'analysis-stops' ? 'block' : 'hidden'}>
              <DataAnalysisStops
                tareas={tareas}
                registroTiempos={registroTiempos}
                lotesCargados={lotesCargados}
                exceptions={exceptions}
                checkedLotes={checkedLotes}
                setCheckedLotes={setCheckedLotes}
                mainTab={analysisMainTab}
                setMainTab={setAnalysisMainTab}
                selectedEsterilesCodes={analysisSelectedEsterilesCodes}
                setSelectedEsterilesCodes={setAnalysisSelectedEsterilesCodes}
                selectedNoEsterilesCodes={analysisSelectedNoEsterilesCodes}
                setSelectedNoEsterilesCodes={setAnalysisSelectedNoEsterilesCodes}
                activeEsterilTab={analysisActiveEsterilTab}
                setActiveEsterilTab={setAnalysisActiveEsterilTab}
                activeNoEsterilTab={analysisActiveNoEsterilTab}
                setActiveNoEsterilTab={setAnalysisActiveNoEsterilTab}
                isEsterilesInitialized={analysisIsEsterilesInitialized}
                setIsEsterilesInitialized={setAnalysisIsEsterilesInitialized}
                isNoEsterilesInitialized={analysisIsNoEsterilesInitialized}
                setIsNoEsterilesInitialized={setAnalysisIsNoEsterilesInitialized}
                isDbInitialized={isDbInitialized}
              />
            </div>
            <div className={view === 'analysis-total' ? 'block' : 'hidden'}>
              <DataAnalysisTotal
                tareas={tareas}
                registroTiempos={registroTiempos}
                lotesCargados={lotesCargados}
                exceptions={exceptions}
                checkedLotes={checkedLotes}
                setCheckedLotes={setCheckedLotes}
                mainTab={analysisMainTab}
                setMainTab={setAnalysisMainTab}
                selectedEsterilesCodes={analysisSelectedEsterilesCodes}
                setSelectedEsterilesCodes={setAnalysisSelectedEsterilesCodes}
                selectedNoEsterilesCodes={analysisSelectedNoEsterilesCodes}
                setSelectedNoEsterilesCodes={setAnalysisSelectedNoEsterilesCodes}
                activeEsterilTab={analysisActiveEsterilTab}
                setActiveEsterilTab={setAnalysisActiveEsterilTab}
                activeNoEsterilTab={analysisActiveNoEsterilTab}
                setActiveNoEsterilTab={setAnalysisActiveNoEsterilTab}
                isEsterilesInitialized={analysisIsEsterilesInitialized}
                setIsEsterilesInitialized={setAnalysisIsEsterilesInitialized}
                isNoEsterilesInitialized={analysisIsNoEsterilesInitialized}
                setIsNoEsterilesInitialized={setAnalysisIsNoEsterilesInitialized}
                isDbInitialized={isDbInitialized}
              />
            </div>
          </div>

        </div>

        {/* Footer Status Bar */}
        <footer className="mt-12 px-6 py-3 bg-slate-900 text-slate-400 flex flex-col sm:flex-row justify-between items-center text-[10px] uppercase font-bold tracking-widest gap-2 rounded-xl shadow-md">
          <div className="flex gap-4">
            <span>DB: Supabase Conectado</span>
            <span>Mode: Production</span>
          </div>
          <div>
            Sesión: grover68111979@gmail.com - 10:42 AM
          </div>
        </footer>

      </div>
    </div>
  );
}
