import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { motion } from 'motion/react';
import { 
  BarChart2, 
  CheckSquare, 
  Square, 
  Maximize2, 
  Minimize2, 
  RotateCcw, 
  Info, 
  Filter,
  Check,
  ChevronDown,
  Columns,
  Search,
  Download
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { IdentificacionTarea, RegistroTiempos, LoteCargado, ExcepcionLaboral, parseIntervalToMs } from '../supabaseClient';

interface DataAnalysisTotalProps {
  tareas: IdentificacionTarea[];
  registroTiempos: RegistroTiempos[];
  lotesCargados?: LoteCargado[];
  exceptions: ExcepcionLaboral[];
  checkedLotes: Record<string, boolean>;
  setCheckedLotes: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  mainTab?: 'ESTÉRILES' | 'NO ESTÉRILES';
  setMainTab?: React.Dispatch<React.SetStateAction<'ESTÉRILES' | 'NO ESTÉRILES'>>;
  selectedEsterilesCodes?: string[];
  setSelectedEsterilesCodes?: React.Dispatch<React.SetStateAction<string[]>>;
  selectedNoEsterilesCodes?: string[];
  setSelectedNoEsterilesCodes?: React.Dispatch<React.SetStateAction<string[]>>;
  activeEsterilTab?: string;
  setActiveEsterilTab?: React.Dispatch<React.SetStateAction<string>>;
  activeNoEsterilTab?: string;
  setActiveNoEsterilTab?: React.Dispatch<React.SetStateAction<string>>;
  isEsterilesInitialized?: boolean;
  setIsEsterilesInitialized?: React.Dispatch<React.SetStateAction<boolean>>;
  isNoEsterilesInitialized?: boolean;
  setIsNoEsterilesInitialized?: React.Dispatch<React.SetStateAction<boolean>>;
  isDbInitialized?: boolean;
}

// Helper to parse dates without timezone shifts
const parseNaiveDate = (str: string | null | undefined): Date | null => {
  if (!str) return null;
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (!match) {
    const fallback = new Date(str);
    return isNaN(fallback.getTime()) ? null : fallback;
  }
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);
  const hours = parseInt(match[4], 10);
  const minutes = parseInt(match[5], 10);
  const seconds = parseInt(match[6], 10);
  
  return new Date(year, month, day, hours, minutes, seconds);
};

// Formatter for worked time durations
const formatDuration = (ms: number): string => {
  if (ms <= 0) return '0s';
  const totalSecs = Math.floor(ms / 1000);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  
  const parts: string[] = [];
  if (hrs > 0) parts.push(`${hrs}h`);
  if (mins > 0 || hrs > 0) parts.push(`${mins}m`);
  parts.push(`${secs}s`);
  return parts.join(' ');
};

// Helper to calculate Coefficient of Variation (CV) as percentage string
const formatCV = (mean: number, stdDev: number): string => {
  if (stdDev === 0 || mean === 0) return '0.0%';
  const cv = (stdDev / mean) * 100;
  return `${cv.toFixed(1)}%`;
};

const buildGridLevels = (xSpanMs: number, xMax: number) => {
  const levels: { step: number; color: string; opacity: number }[] = [];
  const hourStep = 3600000;
  const minuteStep = xSpanMs <= 2 * 3600000 ? (xSpanMs <= 20 * 60000 ? 60000 : 300000) : null;
  const secondStep = xSpanMs <= 3 * 60000 ? 10000 : null;

  levels.push({ step: hourStep, color: '#475569', opacity: 0.35 });
  if (minuteStep) levels.push({ step: minuteStep, color: '#94a3b8', opacity: 0.25 });
  if (secondStep) levels.push({ step: secondStep, color: '#cbd5e1', opacity: 0.5 });
  return levels;
};

const formatRulerLabel = (ms: number, unit: 'h' | 'm' | 's'): string => {
  if (unit === 'h') return `${Math.round(ms / 3600000)}h`;
  if (unit === 'm') return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 1000)}s`;
};

// Extractor of product code before the hyphen
const getProductCode = (lote: string): string => {
  if (!lote) return 'Otros';
  const parts = lote.split('-');
  return (parts[0] || 'Otros').trim();
};

// Labor Calendar stop logic helpers
const isWorkingDay = (date: Date, exceptions: ExcepcionLaboral[]): boolean => {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;

  const exception = exceptions.find((ex) => ex.fecha === dateStr);
  if (exception !== undefined) {
    return exception.es_laboral;
  }

  const dayOfWeek = date.getDay();
  return dayOfWeek !== 0; // default Sunday non-working
};

const getWorkHoursForDay = (date: Date, exceptions: ExcepcionLaboral[]): { startHour: number; endHour: number } | null => {
  if (!isWorkingDay(date, exceptions)) return null;
  const dayOfWeek = date.getDay();
  if (dayOfWeek >= 1 && dayOfWeek <= 5) {
    // Lunes a viernes: 7:00 a 22:00
    return { startHour: 7, endHour: 22 };
  } else if (dayOfWeek === 6) {
    // Sábado: 7:00 a 15:00
    return { startHour: 7, endHour: 15 };
  } else {
    // Domingo excepcionalmente laboral: mismo horario que un día de semana
    return { startHour: 7, endHour: 22 };
  }
};

const getWorkingTimeBetween = (start: Date, end: Date, exceptions: ExcepcionLaboral[]): number => {
  if (start >= end) return 0;

  let totalMs = 0;
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());

  const current = new Date(startDay);
  while (current.getTime() <= endDay.getTime()) {
    const hours = getWorkHoursForDay(current, exceptions);
    if (hours) {
      const workStart = new Date(current.getFullYear(), current.getMonth(), current.getDate(), hours.startHour, 0, 0, 0);
      const workEnd = new Date(current.getFullYear(), current.getMonth(), current.getDate(), hours.endHour, 0, 0, 0);

      const overlapStart = Math.max(start.getTime(), workStart.getTime());
      const overlapEnd = Math.min(end.getTime(), workEnd.getTime());
      if (overlapStart < overlapEnd) {
        totalMs += overlapEnd - overlapStart;
      }
    }
    current.setDate(current.getDate() + 1);
  }

  return totalMs;
};

// Helper to calculate statistics for a specific subprocess across active lotes (based on total time = worked + stop)
interface SubprocessStats {
  mean: number;
  stdDev: number;
  maxVal: number;
  minVal: number;
  hasStats: boolean;
  dataPoints: { lote: string; value: number; worked: number; stopped: number }[];
}

const getSubprocessStats = (
  no_paso: number,
  activeLotes: string[],
  tareas: IdentificacionTarea[],
  registroTiempos: RegistroTiempos[],
  exceptions: ExcepcionLaboral[]
): SubprocessStats => {
  const getLoteSubprocessWorkedMs = (lote: string, paso: number): number => {
    const cleanLote = (lote || '').trim().toUpperCase();
    const task = tareas.find(t => 
      t.nro_lote && 
      (t.nro_lote || '').trim().toUpperCase() === cleanLote && 
      Number(t.no_paso) === Number(paso)
    );
    if (!task) return 0;
    
    const records = registroTiempos
      .filter(r => r.id_t === task.id_t)
      .sort((a, b) => a.secuencia - b.secuencia);
      
    let totalWorkedMs = 0;
    records.forEach(rec => {
      if (rec.fecha_hora_play && rec.fecha_hora_stop) {
        const pTime = parseNaiveDate(rec.fecha_hora_play);
        const sTime = parseNaiveDate(rec.fecha_hora_stop);
        if (pTime && sTime) {
          totalWorkedMs += sTime.getTime() - pTime.getTime();
        }
      }
    });
    return totalWorkedMs;
  };

  const getLoteSubprocessStopMs = (lote: string, paso: number): number => {
    const cleanLote = (lote || '').trim().toUpperCase();
    const task = tareas.find(t => 
      t.nro_lote && 
      (t.nro_lote || '').trim().toUpperCase() === cleanLote && 
      Number(t.no_paso) === Number(paso)
    );
    if (!task) return 0;
    
    const records = registroTiempos
      .filter(r => r.id_t === task.id_t)
      .sort((a, b) => a.secuencia - b.secuencia);
      
    let totalStopMs = 0;
    records.forEach(rec => {
      totalStopMs += parseIntervalToMs(rec.tiempo_parada);
    });

    return totalStopMs;
  };

  const dataPoints = activeLotes.map(lote => {
    const worked = getLoteSubprocessWorkedMs(lote, no_paso);
    const stopped = getLoteSubprocessStopMs(lote, no_paso);
    const value = worked + stopped;
    return { lote, value, worked, stopped };
  });

  const count = dataPoints.length;
  if (count === 0) return { mean: 0, stdDev: 0, maxVal: 0, minVal: 0, hasStats: false, dataPoints };
  
  const values = dataPoints.map(p => p.value);
  const maxVal = Math.max(...values, 0);
  const minVal = Math.min(...values, 0);
  
  if (count === 1) {
    return { mean: values[0] || 0, stdDev: 0, maxVal, minVal, hasStats: true, dataPoints };
  }
  
  const mean = values.reduce((sum, v) => sum + v, 0) / count;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / count;
  const stdDev = Math.sqrt(variance);
  
  return { mean, stdDev, maxVal, minVal, hasStats: true, dataPoints };
};

// Precise clean rounding for time axis limits (margin between 5% and 10% rounded beautifully)
const roundToCleanTime = (ms: number): number => {
  if (ms <= 0) return 60000; // at least 1 minute default
  
  // Target is the value plus a 7% margin
  const targetMs = ms * 1.07;
  const totalSeconds = targetMs / 1000;
  
  if (totalSeconds < 60) {
    // Under 1 minute: round to nearest 5 seconds
    return Math.ceil(totalSeconds / 5) * 5 * 1000;
  }
  
  const totalMinutes = totalSeconds / 60;
  if (totalMinutes < 15) {
    // Under 15 minutes: round to nearest 1 minute
    return Math.ceil(totalMinutes) * 60 * 1000;
  }
  if (totalMinutes < 60) {
    // Under 1 hour: round to nearest 5 minutes
    return Math.ceil(totalMinutes / 5) * 5 * 60 * 1000;
  }
  
  const totalHours = totalMinutes / 60;
  if (totalHours < 6) {
    // Under 6 hours: round to nearest 15 minutes (0.25 hours)
    return Math.ceil(totalHours * 4) / 4 * 3600 * 1000;
  }
  if (totalHours < 24) {
    // Under 24 hours: round to nearest 30 minutes (0.5 hours)
    return Math.ceil(totalHours * 2) / 2 * 3600 * 1000;
  }
  // 24 hours or more: round to nearest 1 hour
  return Math.ceil(totalHours) * 3600 * 1000;
};

// Check if a batch/lote is estéril
const isEsterilLote = (lote: string): boolean => {
  return !lote.includes('-');
};

// Extractor of estéril letter identifier from the batch name (right to left, skipping digits)
const getEstérilLetterIdentifier = (lote: string): string => {
  const text = (lote || '').trim();
  for (let i = text.length - 1; i >= 0; i--) {
    const char = text[i];
    if (/[a-zA-Z]/.test(char)) {
      return char.toUpperCase();
    }
  }
  return '';
};

// Formatter to display product code together with its name/description
const getProductDisplayName = (code: string, descMap: Record<string, string>): string => {
  if (descMap[code]) {
    return `${code} — ${descMap[code]}`;
  }
  return code;
};

// Group Component for a single product code (displayed in its own active tab)
interface ProductGroupProps {
  key?: string | number;
  productCode: string;
  lotes: string[];
  checkedLotes: Record<string, boolean>;
  onToggleLote: (lote: string) => void;
  onToggleAll: (checked: boolean) => void;
  tareas: IdentificacionTarea[];
  registroTiempos: RegistroTiempos[];
  exceptions: ExcepcionLaboral[];
  productDescriptions: Record<string, string>;
}

function ProductGroup({
  productCode,
  lotes,
  checkedLotes,
  onToggleLote,
  onToggleAll,
  tareas,
  registroTiempos,
  exceptions,
  productDescriptions
}: ProductGroupProps) {
  const [loteSearchTerm, setLoteSearchTerm] = useState('');
  
  // Custom zoom step state (options: 5%, 10%, 15%, 20%; default: 10%)
  const [zoomStep, setZoomStep] = useState<number>(0.10);

  // Custom zoom percentage state (1.0 = 100% full scale, 0.0001 = 0.01% scale)
  const [zoomPercent, setZoomPercent] = useState<number>(1.0);

  // Temporary zoom percentage during dragging
  const [tempDragPercent, setTempDragPercent] = useState<number | null>(null);

  // Sorting lotes by natural alphanumeric order
  const sortedLotes = useMemo(() => {
    return [...lotes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  }, [lotes]);

  // Filter sorted lotes by search term
  const filteredSortedLotes = useMemo(() => {
    if (!loteSearchTerm.trim()) return sortedLotes;
    const term = loteSearchTerm.toLowerCase();
    return sortedLotes.filter(l => l.toLowerCase().includes(term));
  }, [sortedLotes, loteSearchTerm]);

  // Extract currently checked/active lotes in this group
  const activeLotes = useMemo(() => {
    return sortedLotes.filter(l => checkedLotes[l]);
  }, [sortedLotes, checkedLotes]);

  const allChecked = useMemo(() => {
    const targetLotes = loteSearchTerm.trim() ? filteredSortedLotes : sortedLotes;
    if (targetLotes.length === 0) return false;
    return targetLotes.every(l => checkedLotes[l]);
  }, [filteredSortedLotes, sortedLotes, checkedLotes, loteSearchTerm]);

  // Handle excel file export
  const handleExportExcel = () => {
    const headers = ['Subproceso', ...activeLotes, 'Promedio', 'Teórico'];
    const aoaData: any[][] = [headers];

    const getSubprocessTiempoEstandar = (paso: number): number | null => {
      const task = tareas.find(t => Number(t.no_paso) === Number(paso) && t.tiempo_estandar != null);
      return task ? Number(task.tiempo_estandar) : null;
    };

    groupedSubprocesses.forEach((processGroup) => {
      processGroup.items.forEach((sub) => {
        const pasoText = sub.etapa || '';
        
        // Pre-calculate statistics for this subprocess once
        const stats = getSubprocessStats(sub.no_paso, activeLotes, tareas, registroTiempos, exceptions);
        
        const rowCells: any[] = [pasoText];
        
        activeLotes.forEach((lote) => {
          const dp = stats.dataPoints.find(dp => (dp.lote || '').trim().toUpperCase() === (lote || '').trim().toUpperCase());
          const totalMs = dp ? dp.value : 0; // Total time (worked + stopped)
          const totalMinutes = totalMs > 0 ? Number((totalMs / 60000).toFixed(2)) : 0;
          rowCells.push(totalMinutes);
        });
        
        // Promedio value in minutes rounded to 2 decimal places
        const meanMinutes = stats.hasStats ? Number((stats.mean / 60000).toFixed(2)) : 0;
        rowCells.push(meanMinutes);
        
        // Teórico value (tiempo_estandar)
        const tiempoEstandar = getSubprocessTiempoEstandar(sub.no_paso);
        rowCells.push(tiempoEstandar !== null ? tiempoEstandar : '');
        
        aoaData.push(rowCells);
      });
    });

    const worksheet = XLSX.utils.aoa_to_sheet(aoaData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Análisis - Total');
    
    const now = new Date();
    const yearStr = now.getFullYear();
    const monthStr = String(now.getMonth() + 1).padStart(2, '0');
    const dayStr = String(now.getDate()).padStart(2, '0');
    const dateString = `${yearStr}-${monthStr}-${dayStr}`;
    
    const fileName = `${productCode}-subproceso_${dateString}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  // Calculate process-subprocess structures for this product code group
  const groupedSubprocesses = useMemo(() => {
    // Relevant tasks belonging to any lote under this product
    const upperLotes = lotes.map(l => (l || '').trim().toUpperCase());
    const relevantTareas = tareas.filter(t => t.nro_lote && upperLotes.includes((t.nro_lote || '').trim().toUpperCase()));
    
    // De-duplicate subprocesses based on no_paso & etapa
    const uniqueMap = new Map<number, { no_paso: number; etapa: string; fase: string; proceso: string }>();
    
    const processNameOf = (etapa: string) => {
      if (etapa.includes('-')) {
        return etapa.split('-')[0].trim();
      }
      return 'FASE';
    };

    const faseNameOf = (etapa: string) => {
      if (etapa.includes('-')) {
        const parts = etapa.split('-');
        return parts.slice(1).join('-').trim();
      }
      return etapa.trim();
    };

    relevantTareas.forEach(t => {
      const proceso = processNameOf(t.etapa);
      const fase = faseNameOf(t.etapa);
      if (!uniqueMap.has(t.no_paso)) {
        uniqueMap.set(t.no_paso, {
          no_paso: t.no_paso,
          etapa: t.etapa,
          fase,
          proceso
        });
      }
    });

    // Sort by no_paso
    const sorted = Array.from(uniqueMap.values()).sort((a, b) => a.no_paso - b.no_paso);

    // Group by process name
    const groups: { proceso: string; items: typeof sorted }[] = [];
    sorted.forEach(item => {
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.proceso === item.proceso) {
        lastGroup.items.push(item);
      } else {
        groups.push({ proceso: item.proceso, items: [item] });
      }
    });

    return groups;
  }, [tareas, lotes]);

  // Calculate the maximum total time (worked + stopped) for ANY subprocess in ANY active lote of this product group
  const maxTotalMsInProductGroup = useMemo(() => {
    let maxVal = 0;
    
    activeLotes.forEach(lote => {
      const cleanLote = (lote || '').trim().toUpperCase();
      const relevantTareasForLote = tareas.filter(t => t.nro_lote && (t.nro_lote || '').trim().toUpperCase() === cleanLote);
      relevantTareasForLote.forEach(task => {
        // worked
        const records = registroTiempos.filter(r => r.id_t === task.id_t);
        let totalWorkedMs = 0;
        records.forEach(rec => {
          if (rec.fecha_hora_play && rec.fecha_hora_stop) {
            const pTime = parseNaiveDate(rec.fecha_hora_play);
            const sTime = parseNaiveDate(rec.fecha_hora_stop);
            if (pTime && sTime) {
              totalWorkedMs += sTime.getTime() - pTime.getTime();
            }
          }
        });

        // stopped
        let totalStopMs = 0;
        let lastStop: Date | null = null;
        const sortedRecords = [...records].sort((a, b) => a.secuencia - b.secuencia);
        sortedRecords.forEach((rec) => {
          const hasPlay = rec.fecha_hora_play !== null && rec.fecha_hora_play !== undefined;
          const hasStop = rec.fecha_hora_stop !== null && rec.fecha_hora_stop !== undefined;

          const pTime = hasPlay ? parseNaiveDate(rec.fecha_hora_play!) : null;
          const sTime = hasStop ? parseNaiveDate(rec.fecha_hora_stop!) : null;

          if (hasPlay && hasStop) {
            if (lastStop && pTime) {
              totalStopMs += getWorkingTimeBetween(lastStop, pTime, exceptions);
            }
            lastStop = sTime;
          } else if (hasPlay && !hasStop) {
            if (lastStop && pTime) {
              totalStopMs += getWorkingTimeBetween(lastStop, pTime, exceptions);
            }
            lastStop = null;
          } else if (!hasPlay && hasStop) {
            lastStop = sTime;
          }
        });

        const totalMs = totalWorkedMs + totalStopMs;
        if (totalMs > maxVal) {
          maxVal = totalMs;
        }
        if (task.tiempo_estandar != null) {
          const teoricoMs = Number(task.tiempo_estandar) * 60000;
          if (teoricoMs > maxVal) {
            maxVal = teoricoMs;
          }
        }
      });
    });
    
    return maxVal;
  }, [tareas, registroTiempos, activeLotes, exceptions]);

  // Rounded maximum timeline boundary
  const roundedMaxLimit = useMemo(() => {
    return roundToCleanTime(maxTotalMsInProductGroup);
  }, [maxTotalMsInProductGroup]);

  // Determine actual visible range boundaries (lower limit is always fixed at 0)
  const { xMin, xMax, xSpan } = useMemo(() => {
    const min = 0;
    const max = roundedMaxLimit * zoomPercent;
    return { xMin: min, xMax: max, xSpan: max - min };
  }, [zoomPercent, roundedMaxLimit]);

  // Zoom Handlers (sync with button and vertical slider steps of zoomStep)
  const handleZoomIn = () => {
    setZoomPercent((prev) => {
      const p = Math.round(prev * 1e10) / 1e10;
      const s = Math.round(zoomStep * 1e10) / 1e10;
      let nextVal;
      if (p <= s) {
        nextVal = p * (1 - s);
      } else {
        nextVal = p - s;
      }
      return Math.max(1e-10, Math.round(nextVal * 1e10) / 1e10);
    });
  };

  const handleZoomOut = () => {
    setZoomPercent((prev) => {
      const p = Math.round(prev * 1e10) / 1e10;
      const s = Math.round(zoomStep * 1e10) / 1e10;
      let nextVal;
      if (p < s) {
        nextVal = p / (1 - s);
      } else {
        nextVal = p + s;
      }
      return Math.min(1.00, Math.round(nextVal * 1e10) / 1e10);
    });
  };

  const handleResetZoom = () => {
    setZoomPercent(1.0);
  };

  // Ruler Ref for horizontal dragging zoom
  const rulerRef = useRef<HTMLDivElement>(null);
  const [isDraggingRuler, setIsDraggingRuler] = useState(false);

  const timeAxisMarks = useMemo(() => {
    const levels = buildGridLevels(xSpan, xMax);
    const marks: { position: number; label: string; level: 'hour' | 'minute' | 'second'; step: number }[] = [];
    const seenPositions = new Set<string>();

    levels.forEach(level => {
      const levelType: 'hour' | 'minute' | 'second' = level.step >= 3600000 ? 'hour' : (level.step >= 60000 ? 'minute' : 'second');
      for (let t = 0; t <= xMax; t += level.step) {
        const position = (t - xMin) / xSpan;
        if (position >= 0 && position <= 1) {
          const posKey = position.toFixed(6);
          if (!seenPositions.has(posKey)) {
            seenPositions.add(posKey);
            const unit: 'h' | 'm' | 's' = level.step >= 3600000 ? 'h' : (level.step >= 60000 ? 'm' : 's');
            marks.push({
              position,
              label: formatRulerLabel(t, unit),
              level: levelType,
              step: level.step
            });
          }
        }
      }
    });

    return marks;
  }, [xMin, xMax, xSpan]);

  const calculateRulerZoomValue = (clientX: number) => {
    if (!rulerRef.current) return 1.0;
    const rect = rulerRef.current.getBoundingClientRect();
    const clickX = clientX - rect.left;
    const pct = clickX / rect.width;
    // Fluidly map to 0.01% - 100%
    return Math.max(0.0001, Math.min(1.00, Math.round(pct * 10000) / 10000));
  };

  const handleRulerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingRuler(true);
    const initialVal = calculateRulerZoomValue(e.clientX);
    setTempDragPercent(initialVal);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRuler) return;
      const val = calculateRulerZoomValue(e.clientX);
      setTempDragPercent(val);
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!isDraggingRuler) return;
      const val = calculateRulerZoomValue(e.clientX);
      setZoomPercent((prev) => {
        const nextVal = prev * val;
        return Math.max(1e-10, Math.min(1.00, Math.round(nextVal * 1e10) / 1e10));
      });
      setTempDragPercent(null);
      setIsDraggingRuler(false);
    };

    if (isDraggingRuler) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingRuler]);

  // Active vertical marker line percentage relative to the ruler
  const activeLinePercent = tempDragPercent !== null ? tempDragPercent : 1.0;

  return (
    <div className="bg-white border border-slate-200 rounded-b-xl shadow-xs mb-8" id={`product-group-${productCode}`}>
      
      {/* Configuration & Filter Sub-panel */}
      <div className="bg-slate-900 px-6 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800">
        <div>
          <span className="text-[9px] font-extrabold bg-emerald-500/10 text-emerald-400 px-2.5 py-1 rounded-full uppercase tracking-wider font-mono">
            Panel de Control
          </span>
          <h3 className="text-base font-black text-white tracking-tight mt-1">
            PRODUCTO: {getProductDisplayName(productCode, productDescriptions)}
          </h3>
          <p className="text-xs text-slate-400 font-medium mt-0.5">
            Activa o desactiva lotes para incluirlos en la comparación estadística.
          </p>
        </div>

        {/* Checkbox selections card */}
        <div className="bg-slate-850 p-3 rounded-lg border border-slate-800 flex flex-wrap items-center gap-4">
          <div className="flex gap-2 text-xs font-bold text-slate-300">
            <button
              onClick={() => {
                const targetLotes = loteSearchTerm.trim() ? filteredSortedLotes : sortedLotes;
                const nextChecked = !allChecked;
                targetLotes.forEach(lote => {
                  if (Boolean(checkedLotes[lote]) !== nextChecked) {
                    onToggleLote(lote);
                  }
                });
              }}
              className="flex items-center gap-1.5 px-2 py-1 hover:bg-slate-800 rounded transition-colors text-slate-200 cursor-pointer"
            >
              {allChecked ? <CheckSquare className="w-4 h-4 text-emerald-400" /> : <Square className="w-4 h-4 text-slate-400" />}
              <span>{allChecked ? 'Desmarcar todos' : 'Marcar todos'}</span>
            </button>
          </div>
          
          <div className="h-4 w-px bg-slate-800 hidden sm:block" />

          {/* Real-time search field for lotes checkboxes */}
          <div className="relative flex items-center bg-slate-950 border border-slate-700 rounded px-2 py-1 gap-1.5 w-44">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              type="text"
              value={loteSearchTerm}
              onChange={(e) => setLoteSearchTerm(e.target.value)}
              placeholder="Filtrar lotes..."
              className="w-full bg-transparent text-white placeholder-slate-500 text-[11px] font-medium focus:outline-hidden"
            />
            {loteSearchTerm && (
              <button
                onClick={() => setLoteSearchTerm('')}
                className="text-slate-400 hover:text-slate-200 text-[10px] font-bold px-1"
              >
                ✕
              </button>
            )}
          </div>

          <div className="h-4 w-px bg-slate-800 hidden md:block" />

          {/* Lotes Checkboxes */}
          <div className="flex flex-wrap items-center gap-3">
            {filteredSortedLotes.length === 0 ? (
              <span className="text-xs text-slate-500 italic font-medium">Ningún lote coincide</span>
            ) : (
              filteredSortedLotes.map(lote => {
                const isChecked = Boolean(checkedLotes[lote]);
                return (
                  <label
                    key={lote}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono font-bold transition-all cursor-pointer select-none ${
                      isChecked 
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25' 
                        : 'bg-slate-800 text-slate-500 border border-transparent'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => onToggleLote(lote)}
                      className="sr-only"
                    />
                    <div className={`w-3.5 h-3.5 rounded flex items-center justify-center border ${
                      isChecked ? 'border-emerald-500 bg-emerald-500 text-slate-900' : 'border-slate-600 bg-slate-950'
                    }`}>
                      {isChecked && (
                        <svg className="w-2.5 h-2.5 stroke-white" fill="none" strokeWidth="3" viewBox="0 0 24 24">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                    <span>{lote}</span>
                  </label>
                );
              })
            )}
          </div>

          <div className="h-4 w-px bg-slate-800 hidden md:block" />

          {/* Excel Export Button - Styled neutrally like the rest of the buttons */}
          <button
            onClick={handleExportExcel}
            disabled={activeLotes.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 disabled:opacity-40 disabled:pointer-events-none text-xs font-bold rounded-lg transition-all cursor-pointer shadow-3xs shrink-0"
            title="Exportar datos a Excel"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Descargar Excel</span>
          </button>
        </div>
      </div>

      {/* Shared Scale Zoom Controls Bar */}
      <div className="sticky top-0 z-30">
        <div className="z-30 bg-slate-50/95 backdrop-blur-md border-b border-slate-200 px-6 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-700">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full font-black text-[10px] uppercase tracking-wider border border-indigo-100">
              Eje unificado
            </span>
            <span className="text-slate-500">Visible:</span>
            <span className="text-slate-900 font-extrabold">{formatDuration(xSpan)}</span>
            {zoomPercent < 1.0 && (
              <span className="bg-amber-50 text-amber-800 text-[10px] px-2.5 py-0.5 rounded-full font-bold border border-amber-200">
                Zoom: {zoomPercent < 0.01 ? (zoomPercent * 100).toFixed(3) : Math.round(zoomPercent * 100)}% [0s - {formatDuration(xMax)}]
              </span>
            )}
          </div>

          <div className="flex items-center gap-4 justify-end shrink-0 w-full sm:w-auto">
            {/* Zoom Step Buttons */}
            <div className="flex gap-1.5 items-center">
              <button
                onClick={handleZoomOut}
                className="px-2.5 py-1.5 text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold transition-all cursor-pointer inline-flex items-center gap-1 shadow-3xs disabled:opacity-50 disabled:pointer-events-none"
                title="Alejar escala horizontal (Suma un paso)"
                disabled={zoomPercent >= 1.0}
              >
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Alejar</span>
              </button>
              <button
                onClick={handleZoomIn}
                className="px-2.5 py-1.5 text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold transition-all cursor-pointer inline-flex items-center gap-1 shadow-3xs disabled:opacity-50 disabled:pointer-events-none"
                title="Acercar escala horizontal (Resta un paso)"
                disabled={zoomPercent <= 0.0001}
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Acercar</span>
              </button>
              {zoomPercent < 1.0 && (
                <button
                  onClick={handleResetZoom}
                  className="px-2.5 py-1.5 text-red-700 bg-red-50 hover:bg-red-100 border border-red-100 rounded-lg text-xs font-bold transition-all cursor-pointer inline-flex items-center gap-1 shadow-3xs"
                  title="Restaurar zoom al 100%"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restaurar</span>
                </button>
              )}
            </div>

            {/* Zoom Step selector dropdown */}
            <div className="flex items-center gap-1.5 pl-3 border-l border-slate-200 shrink-0" id="zoom-step-selector-container">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider select-none leading-none">
                Paso:
              </span>
              <select
                value={zoomStep}
                onChange={(e) => setZoomStep(parseFloat(e.target.value))}
                className="px-2 py-1 bg-white border border-slate-200 rounded text-xs font-mono font-bold text-slate-700 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 cursor-pointer transition-colors"
              >
                <option value="0.05">5%</option>
                <option value="0.10">10%</option>
                <option value="0.15">15%</option>
                <option value="0.20">20%</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Main Table Layout */}
      <div className="p-6">
        {activeLotes.length === 0 ? (
          <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl py-12 text-center text-slate-400 text-xs font-semibold">
            Selecciona al menos un lote para poder visualizar la comparación.
          </div>
        ) : groupedSubprocesses.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-xs font-semibold">
            No se encontraron subprocesos registrados para este código de producto.
          </div>
        ) : (
          <div className="flex gap-4 items-stretch relative">
            <div className="flex-1 overflow-x-auto scrollbar-thin relative">
              <table className="w-full border-collapse border border-slate-200 text-left text-xs text-slate-700 rounded-lg overflow-hidden min-w-[800px]">
                <thead className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600 uppercase text-[10px] tracking-wider select-none">
                  <tr className="h-12" style={{ height: '48px' }}>
                    <th className="px-4 py-1 border-r border-slate-200 w-44 font-black bg-slate-50 z-20 align-middle">Proceso</th>
                    <th className="px-4 py-1 border-r border-slate-200 w-56 font-black bg-slate-50 z-20 align-middle">Sub-proceso</th>
                    <th className="px-4 py-1 border-r border-slate-200 w-32 font-black bg-slate-50 z-20 align-middle">Lote</th>
                    <th className="px-4 pt-1.5 pb-1 relative bg-slate-50 z-20 align-middle">
                      <div className="text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1 flex justify-between">
                        <span>Tiempo Total (Operado + Parada) (Eje de tiempo unificado)</span>
                        <span className="text-[9px] text-red-600 font-bold tracking-wide uppercase">Arrastra el marcador rojo para hacer zoom</span>
                      </div>
                      {/* Interactive timeline scale ruler header */}
                      <div 
                        ref={rulerRef}
                        className="h-5 relative cursor-ew-resize overflow-visible select-none"
                        onMouseDown={handleRulerMouseDown}
                        title="Arrastra el marcador rojo o haz clic en cualquier punto para ajustar el zoom"
                      >
                        {/* Time ticks and labels rendered using exact percent positions */}
                        {timeAxisMarks.map((mark, idx) => (
                          <div
                            key={idx}
                            className="absolute top-0 h-full flex flex-col items-start justify-center border-l border-slate-300 pointer-events-none"
                            style={{ left: `${mark.position * 100}%` }}
                          >
                            <span className="absolute top-0 text-[9px] font-mono font-bold text-slate-500 leading-none whitespace-nowrap">
                              {mark.label}
                            </span>
                          </div>
                        ))}

                        {/* Masked / Cropped Range area on the right during Drag */}
                        {tempDragPercent !== null && (
                      <div 
                        className="absolute right-0 top-0 bottom-0 bg-slate-100/75 border-l border-slate-200 flex items-center justify-center overflow-hidden"
                        style={{ left: `${tempDragPercent * 100}%` }}
                      >
                        {tempDragPercent < 0.95 && (
                          <span className="text-[8px] font-black text-rose-500 uppercase tracking-widest select-none animate-pulse">
                            Recortar
                          </span>
                        )}
                      </div>
                    )}

                    {/* Red Vertical Marker Line Superimposed Across Rows */}
                    <div 
                      className="absolute top-0 w-4 h-[120px] z-40 pointer-events-auto cursor-ew-resize group/zoomline"
                      style={{ 
                        left: `${activeLinePercent * 100}%`, 
                        transform: 'translateX(-50%)',
                      }}
                      onMouseDown={(e) => {
                        handleRulerMouseDown(e);
                      }}
                    >
                      {/* Interactive Drag Handle (Grab button) at the top ruler level */}
                      <div 
                        className="absolute top-0.5 left-1/2 w-7 h-5 flex items-center justify-center bg-red-600 hover:bg-red-500 active:scale-110 text-white rounded-md shadow-md border border-red-500 cursor-ew-resize z-50 pointer-events-auto transition-transform -translate-x-1/2"
                        title="Arrastra horizontalmente"
                      >
                        <div className="flex gap-0.5 items-center justify-center text-[8px] font-black">
                          <span>◀</span>
                          <span>▶</span>
                        </div>
                      </div>

                      {/* Actual Red Line */}
                      <div className="absolute top-0 bottom-0 left-1/2 w-[3px] bg-red-600 -translate-x-1/2 group-hover/zoomline:bg-red-500 transition-colors" />

                      {/* Glowing line overlay */}
                      <div className="absolute top-0 bottom-0 left-1/2 w-[5px] bg-red-500/15 -translate-x-1/2 pointer-events-none" />
                    </div>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {groupedSubprocesses.map((processGroup, pIdx) => {
                const totalSubprocesses = processGroup.items.length;
                const totalLotesCount = activeLotes.length;
                const processRowSpan = totalSubprocesses * totalLotesCount;

                return (
                  <React.Fragment key={`${processGroup.proceso}-${pIdx}`}>
                    {processGroup.items.map((sub, sIdx) => {
                      const subRowSpan = totalLotesCount;
                      const subSpansToProcessEnd = sIdx === processGroup.items.length - 1;

                      // Pre-calculate statistics for this subprocess once
                      const stats = getSubprocessStats(sub.no_paso, activeLotes, tareas, registroTiempos, exceptions);
                      
                      const getSubprocessTiempoEstandar = (paso: number): number | null => {
                        const task = tareas.find(t => Number(t.no_paso) === Number(paso) && t.tiempo_estandar != null);
                        return task ? Number(task.tiempo_estandar) : null;
                      };
                      const tiempoEstandar = getSubprocessTiempoEstandar(sub.no_paso);
                      const teoricoMs = tiempoEstandar != null ? tiempoEstandar * 60000 : null;
                      const teoricoPct = (teoricoMs != null && xSpan > 0) ? ((teoricoMs - xMin) / xSpan) * 100 : null;
                      const devPT = (teoricoMs != null && teoricoMs > 0 && stats.hasStats)
                        ? ((teoricoMs - stats.mean) / teoricoMs) * 100
                        : null;

                      // Positioning for Mean and Std Dev Band
                      const hasStats = stats.hasStats && activeLotes.length >= 1;
                      const meanPct = xSpan > 0 ? ((stats.mean - xMin) / xSpan) * 100 : 0;
                      
                      const leftVal = Math.max(0, stats.mean - stats.stdDev);
                      const rightVal = stats.mean + stats.stdDev;
                      const bandLeftPct = xSpan > 0 ? ((Math.max(xMin, leftVal) - xMin) / xSpan) * 100 : 0;
                      const bandRightPct = xSpan > 0 ? ((Math.min(xMax, rightVal) - xMin) / xSpan) * 100 : 0;
                      const bandWidthPct = Math.max(0, bandRightPct - bandLeftPct);

                      return (
                        <React.Fragment key={sub.no_paso}>
                          {activeLotes.map((lote, lIdx) => {
                            const isFirstInProcess = sIdx === 0 && lIdx === 0;
                            const isFirstInSub = lIdx === 0;

                            const dp = stats.dataPoints.find(dp => (dp.lote || '').trim().toUpperCase() === (lote || '').trim().toUpperCase());
                            const totalValue = dp ? dp.value : 0; // Total time (worked + stopped)
                            const workedMs = dp ? dp.worked : 0;
                            const stopMs = dp ? dp.stopped : 0;
                            
                            // Bar layout widths for stacked segments:
                            let greenWidthPct = 0;
                            let redWidthPct = 0;

                            if (xSpan > 0) {
                              greenWidthPct = (Math.min(workedMs, xMax) / xSpan) * 100;
                              redWidthPct = (Math.max(0, Math.min(workedMs + stopMs, xMax) - workedMs) / xSpan) * 100;
                            }

                            const combinedWidthPct = greenWidthPct + redWidthPct;

                            // Deviation relative metrics (calculated on total value)
                            const deviation = hasStats && stats.mean > 0 
                              ? ((totalValue - stats.mean) / stats.mean) * 100 
                              : null;
                            const devSign = deviation !== null ? (deviation >= 0 ? '+' : '') : '';
                            const devString = deviation !== null ? `${devSign}${deviation.toFixed(1)}%` : '';

                            // Borders
                            const isLastRowOfSub = lIdx === activeLotes.length - 1;
                            const isLastRowOfProcess = sIdx === processGroup.items.length - 1 && isLastRowOfSub;

                            const isFirstRowOfProcessGroup = sIdx === 0 && lIdx === 0;
                            const isFirstRowOfSubprocess = lIdx === 0;

                            const topBorderClass = (pIdx > 0 && isFirstRowOfProcessGroup)
                              ? ''
                              : (sIdx > 0 && isFirstRowOfSubprocess)
                                ? 'border-t-[2px] border-slate-400'
                                : (pIdx === 0 && isFirstRowOfProcessGroup)
                                  ? ''
                                  : 'border-t border-slate-100';
                            const cellBorderClass = isLastRowOfProcess
                              ? 'border-b-[5px] border-indigo-950'
                              : isLastRowOfSub
                                ? 'border-b-[2px] border-slate-400'
                                : 'border-b border-slate-100';

                            const rowHeightStyle = {
                              height: '48px',
                              minHeight: '48px'
                            };

                            return (
                              <React.Fragment key={`${sub.no_paso}-${lote}`}>
                                {(pIdx > 0 && isFirstRowOfProcessGroup) && (
                                  <tr>
                                    <td colSpan={4} className="p-0 h-[5px] bg-indigo-950" />
                                  </tr>
                                )}
                                <tr 
                                  className="group/row hover:bg-slate-50/40 transition-colors h-12 min-h-[48px]"
                                  style={rowHeightStyle}
                                >
                                  {/* Proceso Column */}
                                  {isFirstInProcess && (
                                  <td 
                                    rowSpan={processRowSpan} 
                                    className={`px-4 py-3 border-r border-slate-200 ${topBorderClass} font-sans font-black text-slate-800 uppercase bg-slate-50/40 align-middle text-center max-w-[176px]`}
                                  >
                                    <div className="rotate-0 lg:-rotate-90 lg:whitespace-nowrap tracking-widest text-xs my-4 inline-block font-sans">
                                      {processGroup.proceso}
                                    </div>
                                  </td>
                                )}

                                {/* Sub-proceso Column */}
                                {isFirstInSub && (
                                  <td 
                                    rowSpan={subRowSpan} 
                                    className={`px-4 py-3 border-r border-slate-200 ${topBorderClass} font-sans font-extrabold text-slate-800 bg-white align-middle max-w-[224px]`}
                                  >
                                    <div className="flex flex-col gap-1">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-[9px] font-mono font-black bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded shrink-0">
                                          #{sub.no_paso.toString().padStart(2, '0')}
                                        </span>
                                        <span className="leading-snug uppercase tracking-wide text-xs">
                                          {sub.fase}
                                        </span>
                                      </div>
                                      {hasStats && (
                                        <div className="mt-1.5 text-[9px] font-mono font-bold text-slate-500 bg-slate-50 border border-slate-100 p-1.5 rounded space-y-0.5">
                                          <div>
                                            <span className="text-slate-400">PROM:</span> {formatDuration(stats.mean)}
                                          </div>
                                          <div>
                                            <span className="text-slate-400">DESV:</span> ±{formatDuration(stats.stdDev)}
                                          </div>
                                          <div>
                                            <span className="text-slate-400">CV:</span> {formatCV(stats.mean, stats.stdDev)}
                                          </div>
                                          {teoricoMs != null && (
                                            <div>
                                              <span className="text-slate-400">TEÓRICO:</span> {formatDuration(teoricoMs)}
                                            </div>
                                          )}
                                          {devPT !== null && (
                                            <div>
                                              <span className="text-slate-400">D. P/T:</span> {devPT >= 0 ? '+' : ''}{devPT.toFixed(1)}%
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                )}

                                {/* Lote Name Column */}
                                <td 
                                  className={`relative z-10 px-4 py-0 border-r border-slate-200 ${topBorderClass} font-mono font-extrabold text-slate-600 bg-white w-32 shrink-0 h-12 min-h-[48px]`}
                                  style={rowHeightStyle}
                                >
                                  <div className="h-full min-h-[48px] flex items-center justify-start py-2">
                                    {lote}
                                  </div>
                                </td>

                                {/* Tiempo Total (Operado + Parada) Stacked Bar Visualizer Cell */}
                                <td 
                                  className={`relative z-10 group-hover/row:z-40 p-0 bg-white ${topBorderClass} h-12 min-h-[48px] transition-all`}
                                  style={rowHeightStyle}
                                >
                                  <div className="relative h-full min-h-[48px] w-full flex flex-col justify-center">
                                    {/* Background Vertical Grid Ticks corresponding exactly to timeAxisMarks */}
                                    <div className="absolute inset-y-0 left-4 right-4 pointer-events-none z-0 select-none">
                                      {timeAxisMarks.map((mark, idx) => {
                                        let lineClass = 'bg-slate-100';
                                        if (mark.level === 'hour') {
                                          lineClass = 'bg-slate-300';
                                        } else if (mark.level === 'minute') {
                                          lineClass = 'bg-slate-200';
                                        }
                                        return (
                                          <div
                                            key={idx}
                                            className={`absolute top-0 bottom-0 w-[1.5px] -ml-[0.75px] ${lineClass} opacity-70 z-0`}
                                            style={{ left: `${mark.position * 100}%` }}
                                          />
                                        );
                                      })}
                                    </div>
                                    
                                    {/* Active Area Container */}
                                    <div 
                                      className="absolute inset-0 z-10 px-4 py-2 w-full"
                                    >
                                      {/* Standard Deviation Band Shading */}
                                      {hasStats && bandWidthPct > 0 && bandLeftPct < 100 && (
                                        <div
                                          className="absolute top-0 bottom-0 bg-indigo-500/[0.04] border-x border-indigo-500/10 pointer-events-none z-0"
                                          style={{
                                            left: `${Math.max(0, bandLeftPct)}%`,
                                            width: `${Math.min(100 - bandLeftPct, bandWidthPct)}%`
                                          }}
                                        />
                                      )}

                                      {/* Mean Line Indicator */}
                                      {hasStats && meanPct > 0 && meanPct < 100 && (
                                        <div
                                          className="absolute top-0 bottom-0 border-l-2 border-dashed border-rose-400/70 pointer-events-none z-30"
                                          style={{ left: `${meanPct}%` }}
                                        >
                                          {lIdx === 0 && (
                                            <div className="absolute top-1 -translate-x-1/2 bg-rose-50 text-rose-700 text-[8px] font-black font-mono px-1 py-0.5 rounded border border-rose-200 shadow-3xs z-20 whitespace-nowrap uppercase tracking-wider">
                                              P: {formatDuration(stats.mean)}{devPT !== null && ` (${devPT >= 0 ? '+' : ''}${devPT.toFixed(2)}%)`}
                                            </div>
                                          )}
                                        </div>
                                      )}

                                      {teoricoPct !== null && teoricoPct > 0 && teoricoPct < 100 && (
                                        <div
                                          className="absolute top-0 bottom-0 border-l-2 border-solid border-blue-500/70 pointer-events-none z-30"
                                          style={{ left: `${teoricoPct}%` }}
                                        >
                                          {lIdx === 0 && (
                                            <div className="absolute bottom-1 -translate-x-1/2 bg-blue-50 text-blue-700 text-[8px] font-black font-mono px-1 py-0.5 rounded border border-blue-200 shadow-3xs z-20 whitespace-nowrap uppercase tracking-wider">
                                              T: {formatDuration(teoricoMs || 0)}
                                            </div>
                                          )}
                                        </div>
                                      )}

                                      {/* The stacked bar component */}
                                      <div className="h-full flex items-center relative z-20 w-full">
                                        {totalValue > 0 ? (
                                          <div className="group/bar relative h-6 w-full flex">
                                            
                                            {/* Segment 1: Worked Time (VERDE FIJO) */}
                                            {workedMs > 0 && (
                                              <motion.div
                                                initial={{ width: 0 }}
                                                animate={{ width: `${greenWidthPct}%` }}
                                                transition={{ duration: 0.4, ease: 'easeOut' }}
                                                className="h-full bg-emerald-500 hover:bg-emerald-400 rounded-l-xs transition-colors duration-150 flex items-center justify-center select-none relative overflow-hidden"
                                                style={{
                                                  boxShadow: `inset 0 0 0 1px #10b981`,
                                                }}
                                                title={`Tiempo Operado: ${formatDuration(workedMs)}`}
                                              >
                                                {greenWidthPct > 15 && (
                                                  <span className="text-[9px] font-black text-white truncate drop-shadow-xs font-mono px-1.5">
                                                    {formatDuration(workedMs)}
                                                  </span>
                                                )}
                                              </motion.div>
                                            )}

                                            {/* Segment 2: Stop Time (ROJO) */}
                                            {stopMs > 0 && (
                                              <motion.div
                                                initial={{ width: 0 }}
                                                animate={{ width: `${redWidthPct}%` }}
                                                transition={{ duration: 0.4, ease: 'easeOut' }}
                                                className={`h-full bg-red-500 hover:bg-red-400 transition-colors duration-150 flex items-center justify-center select-none relative overflow-hidden ${
                                                  workedMs === 0 ? 'rounded-l-xs' : ''
                                                } rounded-r-xs`}
                                                style={{
                                                  boxShadow: `inset 0 0 0 1px #ef4444`,
                                                }}
                                                title={`Tiempo de Parada: ${formatDuration(stopMs)}`}
                                              >
                                                {redWidthPct > 15 && (
                                                  <span className="text-[9px] font-black text-white truncate drop-shadow-xs font-mono px-1.5">
                                                    {formatDuration(stopMs)}
                                                  </span>
                                                )}
                                              </motion.div>
                                            )}

                                            {/* Fallback Text label on the right if bar is thin */}
                                            {combinedWidthPct <= 30 && (
                                              <div 
                                                className="absolute left-full top-1/2 -translate-y-1/2 whitespace-nowrap pl-2 text-[9px] font-black text-slate-700 font-mono flex items-center gap-1 bg-white/70 backdrop-blur-3xs rounded px-1 py-0.5"
                                                style={{ left: `${combinedWidthPct}%` }}
                                              >
                                                <span className="text-slate-700 font-black">
                                                  {formatDuration(totalValue)} {devString && `(${devString})`}
                                                </span>
                                              </div>
                                            )}

                                            {/* Standard label on the right side of the bar displaying total duration and deviation */}
                                            {combinedWidthPct > 30 && (
                                              <div 
                                                className="absolute left-full top-1/2 -translate-y-1/2 whitespace-nowrap pl-2 text-[9px] font-black text-slate-700 font-mono flex items-center gap-1 bg-white/70 backdrop-blur-3xs rounded px-1 py-0.5"
                                                style={{ left: `${combinedWidthPct}%` }}
                                              >
                                                <span className="text-slate-700 font-black">
                                                  {formatDuration(totalValue)} {devString && `(${devString})`}
                                                </span>
                                              </div>
                                            )}

                                            {/* Hover Tooltip */}
                                            <div className="absolute opacity-0 pointer-events-none group-hover/bar:opacity-100 transition-opacity bg-slate-950 text-white text-[10px] p-2.5 rounded-lg shadow-xl z-50 -top-24 left-1/2 -translate-x-1/2 whitespace-nowrap border border-slate-800">
                                              <div className="flex items-center gap-1.5 border-b border-slate-800 pb-1 mb-1">
                                                <span className="w-2 h-2 rounded-full bg-indigo-400" />
                                                <span className="font-extrabold text-slate-100 font-mono">Lote: {lote}</span>
                                              </div>
                                              <p className="font-bold text-slate-300">
                                                Tiempo Operado: <span className="text-emerald-400 font-extrabold">{formatDuration(workedMs)}</span>
                                              </p>
                                              <p className="font-bold text-slate-300 mt-0.5">
                                                Tiempo de Parada: <span className="text-red-400 font-extrabold">{formatDuration(stopMs)}</span>
                                              </p>
                                              <p className="font-bold text-slate-300 mt-0.5">
                                                Tiempo Total: <span className="text-white font-extrabold">{formatDuration(totalValue)}</span>
                                              </p>
                                              {hasStats && deviation !== null && (
                                                <p className="font-bold text-slate-300 mt-1 border-t border-slate-850 pt-1">
                                                  Desviación:{' '}
                                                  <span className={`font-black ${deviation >= 0 ? 'text-amber-400' : 'text-sky-400'}`}>
                                                    {devString}
                                                  </span>{' '}
                                                  del promedio total ({formatDuration(stats.mean)})
                                                </p>
                                              )}
                                              <div className="absolute left-1/2 -translate-x-1/2 top-full w-2 h-2 bg-slate-950 rotate-45 border-r border-b border-slate-800" />
                                            </div>
                                          </div>
                                        ) : (
                                          <div className="h-full flex items-center text-[9px] font-bold text-slate-400 italic">
                                            0s (Sin tramos cerrados)
                                          </div>
                                        )}
                                      </div>
                                    </div>

                                    {/* Cropped Area Masking Background during Drag */}
                                    {tempDragPercent !== null && (
                                      <div 
                                        className="absolute right-0 top-0 bottom-0 bg-slate-100/40 border-l border-slate-200 pointer-events-none z-30"
                                        style={{ left: `${tempDragPercent * 100}%` }}
                                      />
                                    )}

                                    {/* Red Vertical Line Segment for this Row */}
                                    <div 
                                      className="absolute inset-y-0 left-4 right-4 pointer-events-none z-40"
                                    >
                                      <div 
                                        className="absolute top-0 bottom-0 w-4 pointer-events-auto cursor-ew-resize group/zoomline"
                                        style={{ 
                                          left: `${activeLinePercent * 100}%`, 
                                          transform: 'translateX(-50%)' 
                                        }}
                                        onMouseDown={(e) => {
                                          handleRulerMouseDown(e);
                                        }}
                                        title="Arrastra horizontalmente para hacer zoom"
                                      >
                                        {/* Actual Red Line */}
                                        <div className="absolute top-0 bottom-0 left-1/2 w-[3px] bg-red-600 -translate-x-1/2 group-hover/zoomline:bg-red-500 transition-colors" />

                                        {/* Glowing line overlay */}
                                        <div className="absolute top-0 bottom-0 left-1/2 w-[5px] bg-red-500/15 -translate-x-1/2 pointer-events-none" />
                                      </div>
                                    </div>

                                  </div>
                                </td>
                              </tr>
                            </React.Fragment>
                          );
                        })}
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
              </table>
            </div>


          </div>
        )}
      </div>
    </div>
  );
}

export default function DataAnalysisTotal({ 
  tareas, 
  registroTiempos, 
  lotesCargados = [],
  exceptions,
  checkedLotes,
  setCheckedLotes,
  mainTab: propMainTab,
  setMainTab: propSetMainTab,
  selectedEsterilesCodes: propSelectedEsterilesCodes,
  setSelectedEsterilesCodes: propSetSelectedEsterilesCodes,
  selectedNoEsterilesCodes: propSelectedNoEsterilesCodes,
  setSelectedNoEsterilesCodes: propSetSelectedNoEsterilesCodes,
  activeEsterilTab: propActiveEsterilTab,
  setActiveEsterilTab: propSetActiveEsterilTab,
  activeNoEsterilTab: propActiveNoEsterilTab,
  setActiveNoEsterilTab: propSetActiveNoEsterilTab,
  isEsterilesInitialized: propIsEsterilesInitialized,
  setIsEsterilesInitialized: propSetIsEsterilesInitialized,
  isNoEsterilesInitialized: propIsNoEsterilesInitialized,
  setIsNoEsterilesInitialized: propSetIsNoEsterilesInitialized,
  isDbInitialized: propIsDbInitialized = true,
}: DataAnalysisTotalProps) {
  
  // 1. Estéril letter mapper to associate letters to id_prd_lin
  const estérilLetterToProductIdMap = useMemo(() => {
    const map: Record<string, string> = {};
    tareas.forEach(t => {
      if (t.nro_lote && !t.nro_lote.includes('-')) {
        const letter = getEstérilLetterIdentifier(t.nro_lote);
        if (letter && t.id_prd_lin) {
          map[letter] = t.id_prd_lin.trim();
        }
      }
    });
    return map;
  }, [tareas]);

  // 2. Map of id_prd_lin to product descriptions from lotesCargados
  const productDescriptions = useMemo(() => {
    const descriptions: Record<string, string> = {};
    
    // Create a map of lote (uppercase) -> product description from lotesCargados
    const loteToDesc: Record<string, string> = {};
    lotesCargados.forEach(lc => {
      if (lc.nro_lote && lc.producto) {
        loteToDesc[lc.nro_lote.trim().toUpperCase()] = lc.producto.trim();
      }
    });

    // Match task's id_prd_lin with the corresponding lote description
    tareas.forEach(t => {
      if (t.id_prd_lin && t.nro_lote) {
        const pId = t.id_prd_lin.trim();
        const cleanLote = t.nro_lote.trim().toUpperCase();
        if (loteToDesc[cleanLote]) {
          descriptions[pId] = loteToDesc[cleanLote];
        }
      }
    });

    return descriptions;
  }, [tareas, lotesCargados]);

  // Helper to determine the product code/id for a lote
  const getLoteProductCode = useCallback((lote: string): string => {
    const cleanLote = (lote || '').trim();
    if (cleanLote.includes('-')) {
      // NO ESTÉRIL: use its id_prd_lin directly from tasks
      const task = tareas.find(t => (t.nro_lote || '').trim().toUpperCase() === cleanLote.toUpperCase());
      if (task && task.id_prd_lin) {
        return task.id_prd_lin.trim();
      }
      return 'UNKNOWN_NO_ESTÉRIL';
    } else {
      // ESTÉRIL: find the letter, then map to id_prd_lin
      const letter = getEstérilLetterIdentifier(cleanLote);
      if (letter && estérilLetterToProductIdMap[letter]) {
        return estérilLetterToProductIdMap[letter];
      }
      const task = tareas.find(t => (t.nro_lote || '').trim().toUpperCase() === cleanLote.toUpperCase());
      if (task && task.id_prd_lin) {
        return task.id_prd_lin.trim();
      }
      return letter || 'UNKNOWN_ESTÉRIL';
    }
  }, [tareas, estérilLetterToProductIdMap]);

  // Main navigation tab
  const [localMainTab, setLocalMainTab] = useState<'ESTÉRILES' | 'NO ESTÉRILES'>('NO ESTÉRILES');
  const mainTab = propMainTab !== undefined ? propMainTab : localMainTab;
  const setMainTab = propSetMainTab !== undefined ? propSetMainTab : setLocalMainTab;

  const [isFullScreen, setIsFullScreen] = useState(false);

  // Product Group Selector States per Category
  const [localSelectedEsterilesCodes, setLocalSelectedEsterilesCodes] = useState<string[]>([]);
  const selectedEsterilesCodes = propSelectedEsterilesCodes !== undefined ? propSelectedEsterilesCodes : localSelectedEsterilesCodes;
  const setSelectedEsterilesCodes = propSetSelectedEsterilesCodes !== undefined ? propSetSelectedEsterilesCodes : setLocalSelectedEsterilesCodes;

  const [localSelectedNoEsterilesCodes, setLocalSelectedNoEsterilesCodes] = useState<string[]>([]);
  const selectedNoEsterilesCodes = propSelectedNoEsterilesCodes !== undefined ? propSelectedNoEsterilesCodes : localSelectedNoEsterilesCodes;
  const setSelectedNoEsterilesCodes = propSetSelectedNoEsterilesCodes !== undefined ? propSetSelectedNoEsterilesCodes : setLocalSelectedNoEsterilesCodes;

  const [localActiveEsterilTab, setLocalActiveEsterilTab] = useState<string>('');
  const activeEsterilTab = propActiveEsterilTab !== undefined ? propActiveEsterilTab : localActiveEsterilTab;
  const setActiveEsterilTab = propSetActiveEsterilTab !== undefined ? propSetActiveEsterilTab : setLocalActiveEsterilTab;

  const [localActiveNoEsterilTab, setLocalActiveNoEsterilTab] = useState<string>('');
  const activeNoEsterilTab = propActiveNoEsterilTab !== undefined ? propActiveNoEsterilTab : localActiveNoEsterilTab;
  const setActiveNoEsterilTab = propSetActiveNoEsterilTab !== undefined ? propSetActiveNoEsterilTab : setLocalActiveNoEsterilTab;

  const [localIsEsterilesInitialized, setLocalIsEsterilesInitialized] = useState(false);
  const isEsterilesInitialized = propIsEsterilesInitialized !== undefined ? propIsEsterilesInitialized : localIsEsterilesInitialized;
  const setIsEsterilesInitialized = propSetIsEsterilesInitialized !== undefined ? propSetIsEsterilesInitialized : setLocalIsEsterilesInitialized;

  const [localIsNoEsterilesInitialized, setLocalIsNoEsterilesInitialized] = useState(false);
  const isNoEsterilesInitialized = propIsNoEsterilesInitialized !== undefined ? propIsNoEsterilesInitialized : localIsNoEsterilesInitialized;
  const setIsNoEsterilesInitialized = propSetIsNoEsterilesInitialized !== undefined ? propSetIsNoEsterilesInitialized : setLocalIsNoEsterilesInitialized;

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [productSearchTerm, setProductSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Reset product search term on dropdown close or category change
  useEffect(() => {
    if (!isDropdownOpen) {
      setProductSearchTerm('');
    }
  }, [isDropdownOpen]);

  useEffect(() => {
    setProductSearchTerm('');
  }, [mainTab]);

  // Get unique batches/lotes from BOTH tareas and lotesCargados to ensure NO batch/code is missed
  const uniqueLotes = useMemo(() => {
    const set = new Set<string>();
    
    // Add lotes from tareas
    tareas.forEach(t => {
      if (t.nro_lote) {
        set.add(t.nro_lote.trim());
      }
    });

    // Add lotes from lotesCargados
    if (lotesCargados) {
      lotesCargados.forEach(l => {
        if (l.nro_lote) {
          set.add(l.nro_lote.trim());
        }
      });
    }

    return Array.from(set).filter(Boolean).sort();
  }, [tareas, lotesCargados]);

  // Separate lotes into Estéril vs No Estéril
  const esterilesLotes = useMemo(() => {
    return uniqueLotes.filter(l => isEsterilLote(l));
  }, [uniqueLotes]);

  const noEsterilesLotes = useMemo(() => {
    return uniqueLotes.filter(l => !isEsterilLote(l));
  }, [uniqueLotes]);

  // Group unique batches by product code
  const esterilesGroups = useMemo(() => {
    const groups: Record<string, string[]> = {};
    esterilesLotes.forEach(lote => {
      const code = getLoteProductCode(lote);
      if (!groups[code]) {
        groups[code] = [];
      }
      groups[code].push(lote);
    });
    return groups;
  }, [esterilesLotes, getLoteProductCode]);

  const noEsterilesGroups = useMemo(() => {
    const groups: Record<string, string[]> = {};
    noEsterilesLotes.forEach(lote => {
      const code = getLoteProductCode(lote);
      if (!groups[code]) {
        groups[code] = [];
      }
      groups[code].push(lote);
    });
    return groups;
  }, [noEsterilesLotes, getLoteProductCode]);

  // Sorted product codes for each tab
  const esterilesProductCodes = useMemo(() => {
    return Object.keys(esterilesGroups).sort();
  }, [esterilesGroups]);

  const noEsterilesProductCodes = useMemo(() => {
    return Object.keys(noEsterilesGroups).sort();
  }, [noEsterilesGroups]);

  // Initialize No Estériles: select only the FIRST product code tab by default
  useEffect(() => {
    if (!propIsDbInitialized) return;
    if (noEsterilesProductCodes.length > 0 && !isNoEsterilesInitialized) {
      const firstCode = noEsterilesProductCodes[0];
      setSelectedNoEsterilesCodes([firstCode]);
      setActiveNoEsterilTab(firstCode);
      setIsNoEsterilesInitialized(true);
    }
  }, [noEsterilesProductCodes, isNoEsterilesInitialized, propIsDbInitialized]);

  // Initialize Estériles: select only the FIRST product code tab by default
  useEffect(() => {
    if (!propIsDbInitialized) return;
    if (esterilesProductCodes.length > 0 && !isEsterilesInitialized) {
      const firstCode = esterilesProductCodes[0];
      setSelectedEsterilesCodes([firstCode]);
      setActiveEsterilTab(firstCode);
      setIsEsterilesInitialized(true);
    }
  }, [esterilesProductCodes, isEsterilesInitialized, propIsDbInitialized]);

  // Unified active states depending on current main tab Selection
  const isEsteril = mainTab === 'ESTÉRILES';
  const currentProductCodes = isEsteril ? esterilesProductCodes : noEsterilesProductCodes;
  const currentGroups = isEsteril ? esterilesGroups : noEsterilesGroups;
  const selectedProductCodes = isEsteril ? selectedEsterilesCodes : selectedNoEsterilesCodes;
  const setSelectedProductCodes = isEsteril ? setSelectedEsterilesCodes : setSelectedNoEsterilesCodes;
  const activeProductCodeTab = isEsteril ? activeEsterilTab : activeNoEsterilTab;
  const setActiveProductCodeTab = isEsteril ? setActiveEsterilTab : setActiveNoEsterilTab;

  // Filter product codes in real time by product code, description, and its lotes
  const filteredProductCodes = useMemo(() => {
    if (!productSearchTerm.trim()) return currentProductCodes;
    const term = productSearchTerm.toLowerCase();
    return currentProductCodes.filter((code) => {
      const desc = (productDescriptions[code] || '').toLowerCase();
      const lotes = currentGroups[code] || [];
      const hasMatchingLote = lotes.some((lote) => lote.toLowerCase().includes(term));
      return (
        code.toLowerCase().includes(term) ||
        desc.includes(term) ||
        hasMatchingLote
      );
    });
  }, [currentProductCodes, productSearchTerm, productDescriptions, currentGroups]);

  const handleToggleLote = (lote: string) => {
    setCheckedLotes(prev => ({
      ...prev,
      [lote]: !prev[lote]
    }));
  };

  const handleToggleAllForProduct = (productCode: string, checked: boolean) => {
    const productLotes = currentGroups[productCode] || [];
    setCheckedLotes(prev => {
      const next = { ...prev };
      productLotes.forEach(lote => {
        next[lote] = checked;
      });
      return next;
    });
  };

  const handleToggleProductCode = (code: string) => {
    setSelectedProductCodes(prev => {
      let next: string[];
      if (prev.includes(code)) {
        next = prev.filter(c => c !== code);
      } else {
        next = [...prev, code];
      }
      
      // If the currently active tab was removed, select another one
      if (activeProductCodeTab === code && next.length > 0) {
        setActiveProductCodeTab(next[0]);
      } else if (next.length > 0 && !next.includes(activeProductCodeTab)) {
        setActiveProductCodeTab(next[0]);
      }
      return next;
    });
  };

  const handleSelectAllProducts = () => {
    setSelectedProductCodes(currentProductCodes);
    if (currentProductCodes.length > 0 && !currentProductCodes.includes(activeProductCodeTab)) {
      setActiveProductCodeTab(currentProductCodes[0]);
    }
  };

  const handleClearAllProducts = () => {
    setSelectedProductCodes([]);
    setActiveProductCodeTab('');
  };

  const triggerLabel = useMemo(() => {
    if (selectedProductCodes.length === 0) {
      return 'Ningún grupo seleccionado';
    }
    if (currentProductCodes.length > 0 && selectedProductCodes.length === currentProductCodes.length) {
      return 'Todos los grupos seleccionados';
    }
    return `${selectedProductCodes.length} ${selectedProductCodes.length === 1 ? 'grupo seleccionado' : 'grupos seleccionados'}`;
  }, [selectedProductCodes, currentProductCodes]);

  const hasData = uniqueLotes.length > 0;

  return (
    <div 
      className={isFullScreen 
        ? "fixed inset-0 z-50 bg-slate-50 overflow-auto p-6 md:p-8 flex flex-col space-y-6" 
        : "space-y-6"
      } 
      id="data-analysis-total-root"
    >
      {/* Header section of the view */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
              <BarChart2 className="w-5 h-5" />
            </span>
            <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">
              Análisis Comparativo de Tiempos Totales
            </h2>
          </div>
          <p className="text-xs text-slate-500 font-semibold mt-1">
            Esta sección agrupa automáticamente los lotes según su código de producto y compara estadísticamente el tiempo total sumado (tiempo operado + tiempo de parada).
          </p>
        </div>

        {/* General details info & Full Screen Toggle */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-100 px-3.5 py-2 rounded-lg text-slate-600 text-[10px] uppercase font-bold font-mono">
            <Columns className="w-4 h-4 text-slate-400" />
            <span>Lotes Totales: {uniqueLotes.length}</span>
            <span className="text-slate-300">|</span>
            <span>Grupos: {esterilesProductCodes.length + noEsterilesProductCodes.length}</span>
          </div>

          <button
            onClick={() => setIsFullScreen(!isFullScreen)}
            className="p-2 hover:bg-slate-100 rounded-lg text-slate-700 transition-colors cursor-pointer flex items-center gap-1.5 border border-slate-200 shadow-3xs bg-white font-extrabold text-[11px] uppercase tracking-wide"
            title={isFullScreen ? "Salir de pantalla completa" : "Pantalla completa"}
          >
            {isFullScreen ? (
              <>
                <Minimize2 className="w-4 h-4 text-blue-600" />
                <span>Contraer</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-4 h-4 text-slate-600" />
                <span>Pantalla Completa</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Category Tabs: ESTÉRILES vs NO ESTÉRILES */}
      {hasData && (
        <div className="flex bg-white border border-slate-200 rounded-xl p-1.5 gap-2 shadow-3xs" id="main-category-tabs">
          <button
            onClick={() => setMainTab('NO ESTÉRILES')}
            className={`flex-1 py-3 px-4 rounded-lg text-xs font-black tracking-wider transition-all uppercase flex items-center justify-center gap-2 cursor-pointer ${
              mainTab === 'NO ESTÉRILES'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <span>No Estériles</span>
            <span className={`px-2 py-0.5 rounded-full text-[9px] font-mono ${
              mainTab === 'NO ESTÉRILES' ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-600'
            }`}>
              {noEsterilesLotes.length} lotes
            </span>
          </button>
          <button
            onClick={() => setMainTab('ESTÉRILES')}
            className={`flex-1 py-3 px-4 rounded-lg text-xs font-black tracking-wider transition-all uppercase flex items-center justify-center gap-2 cursor-pointer ${
              mainTab === 'ESTÉRILES'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <span>Estériles</span>
            <span className={`px-2 py-0.5 rounded-full text-[9px] font-mono ${
              mainTab === 'ESTÉRILES' ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-600'
            }`}>
              {esterilesLotes.length} lotes
            </span>
          </button>
        </div>
      )}

      {/* Product Groups Selector Dropdown Card */}
      {hasData && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs" id="product-group-selector-container">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                <Filter className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">Filtro de Grupos de Producto ({mainTab})</h3>
                <p className="text-xs text-slate-500 font-semibold">Elige qué productos comparar en pantalla para un análisis enfocado</p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <button
                onClick={handleSelectAllProducts}
                className="text-slate-900 hover:text-black font-bold bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-all cursor-pointer"
                disabled={currentProductCodes.length === 0}
              >
                Seleccionar todos
              </button>
              <button
                onClick={handleClearAllProducts}
                className="text-slate-500 hover:text-slate-800 font-bold bg-slate-50 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-all cursor-pointer"
              >
                Limpiar selección
              </button>
            </div>
          </div>

          <div className="mt-4 relative" ref={dropdownRef}>
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="w-full sm:w-96 flex items-center justify-between gap-3 px-4 py-2.5 bg-white border border-slate-200 hover:border-slate-300 rounded-lg text-sm font-semibold text-slate-800 hover:text-slate-950 shadow-3xs transition-all cursor-pointer"
            >
              <span className="flex items-center gap-2 truncate">
                <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse shrink-0" />
                <span className="truncate">{triggerLabel}</span>
              </span>
              <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-250 shrink-0 ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown options */}
            {isDropdownOpen && (
              <div className="absolute left-0 mt-2 w-full sm:w-115 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-80 flex flex-col overflow-hidden">
                {/* Search Input Field */}
                <div className="p-2.5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
                  <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <input
                    type="text"
                    value={productSearchTerm}
                    onChange={(e) => setProductSearchTerm(e.target.value)}
                    placeholder="Buscar producto por código, nombre o lote..."
                    className="w-full bg-white border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-800 placeholder-slate-400"
                    onClick={(e) => e.stopPropagation()} // Prevent closing dropdown
                    autoFocus
                  />
                </div>

                <div className="overflow-y-auto p-2 space-y-0.5 flex-1 max-h-56">
                  {filteredProductCodes.length === 0 ? (
                    <div className="text-xs text-slate-400 py-4 text-center font-medium">
                      No se encontraron resultados
                    </div>
                  ) : (
                    filteredProductCodes.map((code) => {
                      const isSelected = selectedProductCodes.includes(code);
                      const displayName = getProductDisplayName(code, productDescriptions);
                      return (
                        <button
                          key={code}
                          onClick={() => handleToggleProductCode(code)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all text-left cursor-pointer ${
                            isSelected ? 'bg-indigo-50 text-indigo-700 font-bold' : 'hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          <div className={`w-4 h-4 rounded-md flex items-center justify-center border shrink-0 transition-all ${
                            isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300'
                          }`}>
                            {isSelected && <Check className="w-2.5 h-2.5 stroke-[3.5]" />}
                          </div>
                          <span className="font-mono truncate" title={displayName}>{displayName}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tabs navigation for selected product groups */}
      {hasData && selectedProductCodes.length > 0 && (
        <div className="flex bg-white px-6 border border-slate-200 rounded-t-xl gap-2 overflow-x-auto scrollbar-elegant mb-0 pt-2" id="product-tabs-bar">
          {selectedProductCodes.map((code) => {
            const isActive = activeProductCodeTab === code;
            return (
              <button
                key={code}
                onClick={() => setActiveProductCodeTab(code)}
                id={`product-tab-button-${code}`}
                className={`px-5 py-3 border-b-2 text-xs font-bold transition-all cursor-pointer whitespace-nowrap relative ${
                  isActive
                    ? 'border-slate-900 text-slate-900 font-extrabold'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                <span>{code}</span>
                {isActive && (
                  <motion.div
                    layoutId="active-product-tab-line"
                    className="absolute bottom-0 left-0 right-0 h-[2px] bg-slate-900"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Main product groups output panel */}
      {!hasData ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-400">
          <div className="p-3 bg-slate-100 text-slate-700 rounded-full inline-block mb-3">
            <BarChart2 className="w-8 h-8" />
          </div>
          <h4 className="font-bold text-slate-800 text-sm">Sin datos para analizar</h4>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto font-medium">
            No se han encontrado registros en las tablas de Supabase. Conecta y carga datos para visualizar los análisis estadísticos.
          </p>
        </div>
      ) : selectedProductCodes.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-400">
          <div className="p-3 bg-slate-100 text-slate-700 rounded-full inline-block mb-3">
            <Filter className="w-8 h-8" />
          </div>
          <h4 className="font-bold text-slate-800 text-sm">Ningún producto seleccionado</h4>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto font-medium">
            Usa el selector superior para elegir qué grupos de producto quieres visualizar en la sección {mainTab}.
          </p>
        </div>
      ) : !activeProductCodeTab || !currentGroups[activeProductCodeTab] ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-400">
          <h4 className="font-bold text-slate-800 text-sm">Cargando pestaña seleccionada...</h4>
        </div>
      ) : (
        <ProductGroup
          key={`${mainTab}-${activeProductCodeTab}`}
          productCode={activeProductCodeTab}
          lotes={currentGroups[activeProductCodeTab]}
          checkedLotes={checkedLotes}
          onToggleLote={handleToggleLote}
          onToggleAll={(checked) => handleToggleAllForProduct(activeProductCodeTab, checked)}
          tareas={tareas}
          registroTiempos={registroTiempos}
          exceptions={exceptions}
          productDescriptions={productDescriptions}
        />
      )}
    </div>
  );
}
