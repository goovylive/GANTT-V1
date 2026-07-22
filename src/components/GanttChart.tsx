import React, { useState, useRef, useEffect, useMemo } from 'react';
import { AlertTriangle, ZoomIn, ZoomOut, RotateCcw, Move, Maximize2, Minimize2 } from 'lucide-react';
import { IdentificacionTarea, RegistroTiempos } from '../supabaseClient';

interface GanttChartProps {
  lote: string;
  tareas: IdentificacionTarea[];
  registroTiempos: RegistroTiempos[];
  exceptions: Array<{ fecha: string; es_laboral: boolean }>;
  onDateRangeChange?: (range: { min: Date; max: Date } | null) => void;
  lotesCargados?: Array<{ nro_lote: string; producto: string }>;
}

interface TimelineSegment {
  start: Date;
  end: Date;
  type: 'green' | 'red' | 'blank';
  isOpen?: boolean;
  description: string;
}

interface TimelineMarker {
  time: Date;
  type: 'red-line' | 'arrow';
  isOpen?: boolean;
}

interface GroupedSubprocess {
  proceso: string;
  items: Array<{
    id_t: string;
    no_paso: number;
    etapa: string;
    fase: string;
    sp: IdentificacionTarea;
  }>;
}

// 24h manual formatter helper to bypass local OS differences
const format24h = (date: Date, includeSeconds = false): string => {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  if (includeSeconds) {
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }
  return `${hours}:${minutes}`;
};

// Parser to extract literal dates from timestamptz (e.g. 2026-04-02T07:53:50+00:00) without timezone shifts
const parseNaiveDate = (str: string | null | undefined): Date | null => {
  if (!str) return null;
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (!match) {
    const fallback = new Date(str);
    return isNaN(fallback.getTime()) ? null : fallback;
  }
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1; // 0-indexed month
  const day = parseInt(match[3], 10);
  const hours = parseInt(match[4], 10);
  const minutes = parseInt(match[5], 10);
  const seconds = parseInt(match[6], 10);
  
  return new Date(year, month, day, hours, minutes, seconds);
};

export default function GanttChart({
  lote,
  tareas,
  registroTiempos,
  exceptions,
  onDateRangeChange,
  lotesCargados
}: GanttChartProps) {
  const currentTime = new Date();
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [zoom, setZoom] = useState<number>(1);
  const gridRef = useRef<HTMLDivElement>(null);

  // Hover tracker
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const [hoverTime, setHoverTime] = useState<Date | null>(null);
  const [hoverY, setHoverY] = useState<number | null>(null);

  // Interaction Mode State
  const [interactionMode, setInteractionMode] = useState<'move' | 'zoom-select'>('move');
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState<number | null>(null);
  const dragStartMs = useRef<{ min: number; max: number } | null>(null);

  // Selection rectangle percentages
  const [zoomStartPct, setZoomStartPct] = useState<number | null>(null);
  const [zoomCurrentPct, setZoomCurrentPct] = useState<number | null>(null);

  // Filter subprocesses and times for this specific batch
  const batchSubprocesses = useMemo(() => {
    const cleanLote = (lote || '').trim().toUpperCase();
    return tareas
      .filter((t) => t.nro_lote && (t.nro_lote || '').trim().toUpperCase() === cleanLote)
      .sort((a, b) => a.no_paso - b.no_paso);
  }, [tareas, lote]);

  const batchTimes = useMemo(() => {
    const batchSubprocessIds = batchSubprocesses.map((p) => p.id_t);
    return registroTiempos.filter((t) => batchSubprocessIds.includes(t.id_t));
  }, [registroTiempos, batchSubprocesses]);

  // Check if we have any time records
  const hasRecords = batchTimes.length > 0;

  // 1. Dynamic axis bounds calculation: ONLY using closed segments (pairs of play+stop)
  const baseRange = useMemo(() => {
    let baseMin = new Date();
    let baseMax = new Date();

    const closedTimes: number[] = [];
    batchTimes.forEach((rec) => {
      if (rec.fecha_hora_play && rec.fecha_hora_stop) {
        const p = parseNaiveDate(rec.fecha_hora_play);
        const s = parseNaiveDate(rec.fecha_hora_stop);
        if (p && s) {
          closedTimes.push(p.getTime());
          closedTimes.push(s.getTime());
        }
      }
    });

    if (closedTimes.length > 0) {
      baseMin = new Date(Math.min(...closedTimes));
      baseMax = new Date(Math.max(...closedTimes));
    } else {
      // Fallback: If no closed times, check if we have any plays or stops
      const allTimes: number[] = [];
      batchTimes.forEach((rec) => {
        const p = parseNaiveDate(rec.fecha_hora_play);
        const s = parseNaiveDate(rec.fecha_hora_stop);
        if (p) allTimes.push(p.getTime());
        if (s) allTimes.push(s.getTime());
      });
      if (allTimes.length > 0) {
        baseMin = new Date(Math.min(...allTimes));
        baseMax = new Date(Math.max(...allTimes));
      } else {
        baseMin = new Date();
        baseMin.setHours(8, 0, 0, 0);
        baseMax = new Date();
        baseMax.setHours(18, 0, 0, 0);
      }
    }

    // Padding
    let baseMinPadded = baseMin;
    let baseMaxPadded = baseMax;
    const baseDurationMs = baseMax.getTime() - baseMin.getTime();

    if (baseDurationMs <= 0) {
      baseMinPadded = new Date();
      baseMinPadded.setHours(8, 0, 0, 0);
      baseMaxPadded = new Date();
      baseMaxPadded.setHours(18, 0, 0, 0);
    } else if (baseDurationMs < 60000) {
      baseMinPadded = new Date(baseMin.getTime() - 30 * 60 * 1000);
      baseMaxPadded = new Date(baseMax.getTime() + 30 * 60 * 1000);
    } else {
      const padding = Math.max(baseDurationMs * 0.05, 10 * 60 * 1000); // at least 10 minutes
      baseMinPadded = new Date(baseMin.getTime() - padding);
      baseMaxPadded = new Date(baseMax.getTime() + padding);
    }

    return { min: baseMinPadded, max: baseMaxPadded };
  }, [batchTimes]);

  // Visible bounds state (used for panning & zoom-selection)
  const [customRange, setCustomRange] = useState<{ min: Date; max: Date } | null>(null);

  // Reset custom range when lote changes
  useEffect(() => {
    setCustomRange(null);
    setZoom(1);
  }, [lote, batchTimes.length]);

  const minTime = customRange ? customRange.min : baseRange.min;
  const maxTime = customRange ? customRange.max : baseRange.max;
  const rangeMs = maxTime.getTime() - minTime.getTime();

  useEffect(() => {
    if (onDateRangeChange) {
      onDateRangeChange({ min: minTime, max: maxTime });
    }
    return () => {
      if (onDateRangeChange) {
        onDateRangeChange(null);
      }
    };
  }, [minTime, maxTime, onDateRangeChange]);

  // State and refs for horizontal custom scrollbar
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTrackRef = useRef<HTMLDivElement>(null);
  const scrollDragStart = useRef<{ minTimeMs: number; maxTimeMs: number; x: number } | null>(null);

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isScrolling || !scrollDragStart.current || !scrollTrackRef.current) return;
      const rect = scrollTrackRef.current.getBoundingClientRect();
      const deltaX = e.clientX - scrollDragStart.current.x;
      const totalRangeMs = baseRange.max.getTime() - baseRange.min.getTime();
      const msPerPixel = totalRangeMs / rect.width;
      const timeDelta = deltaX * msPerPixel;

      const visibleDuration = scrollDragStart.current.maxTimeMs - scrollDragStart.current.minTimeMs;
      
      let newMinMs = scrollDragStart.current.minTimeMs + timeDelta;
      let newMaxMs = newMinMs + visibleDuration;

      const limitMinMs = baseRange.min.getTime() - 3600000;
      const limitMaxMs = baseRange.max.getTime() + 3600000;

      if (newMinMs < limitMinMs) {
        newMinMs = limitMinMs;
        newMaxMs = newMinMs + visibleDuration;
      }
      if (newMaxMs > limitMaxMs) {
        newMaxMs = limitMaxMs;
        newMinMs = newMaxMs - visibleDuration;
      }

      setCustomRange({
        min: new Date(newMinMs),
        max: new Date(newMaxMs),
      });
    };

    const handleGlobalMouseUp = () => {
      setIsScrolling(false);
      scrollDragStart.current = null;
    };

    if (isScrolling) {
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isScrolling, baseRange]);

  const handleScrollTrackClick = (e: React.MouseEvent) => {
    if (!scrollTrackRef.current) return;
    if ((e.target as HTMLElement).closest('.scrollbar-thumb')) return;

    const rect = scrollTrackRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = clickX / rect.width;

    const totalRangeMs = baseRange.max.getTime() - baseRange.min.getTime();
    const clickTimeMs = baseRange.min.getTime() + ratio * totalRangeMs;

    const visibleDuration = maxTime.getTime() - minTime.getTime();
    let newMinMs = clickTimeMs - visibleDuration / 2;
    let newMaxMs = newMinMs + visibleDuration;

    const limitMinMs = baseRange.min.getTime() - 3600000;
    const limitMaxMs = baseRange.max.getTime() + 3600000;

    if (newMinMs < limitMinMs) {
      newMinMs = limitMinMs;
      newMaxMs = newMinMs + visibleDuration;
    }
    if (newMaxMs > limitMaxMs) {
      newMaxMs = limitMaxMs;
      newMinMs = newMaxMs - visibleDuration;
    }

    setCustomRange({
      min: new Date(newMinMs),
      max: new Date(newMaxMs),
    });
  };

  const handleScrollThumbMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!scrollTrackRef.current) return;
    setIsScrolling(true);
    scrollDragStart.current = {
      minTimeMs: minTime.getTime(),
      maxTimeMs: maxTime.getTime(),
      x: e.clientX,
    };
  };

  // Helper to convert date to timeline percentage using compressed working-time scale
  const getPct = (date: Date): number => {
    const totalWorkingMs = getWorkingTimeBetween(minTime, maxTime);
    if (totalWorkingMs <= 0) {
      const pct = ((date.getTime() - minTime.getTime()) / rangeMs) * 100;
      return Math.max(0, Math.min(100, pct));
    }
    const elapsedWorkingMs = getWorkingTimeBetween(minTime, date);
    const pct = (elapsedWorkingMs / totalWorkingMs) * 100;
    return Math.max(0, Math.min(100, pct));
  };

  // Helper to check if a date (day) is a working day based on exceptions and defaults
  const isWorkingDay = (date: Date): boolean => {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    const exception = exceptions.find((ex) => ex.fecha === dateStr);
    if (exception !== undefined) {
      return exception.es_laboral;
    }

    const dayOfWeek = date.getDay();
    return dayOfWeek !== 0; // Mon-Sat are working (1-6)
  };

  // Helper to retrieve the working hours limits for a specific day
  const getWorkHoursForDay = (date: Date): { startHour: number; endHour: number } | null => {
    if (!isWorkingDay(date)) return null;
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

  // Helper to calculate total working milliseconds between two dates (Point 3)
  const getWorkingTimeBetween = (start: Date, end: Date): number => {
    if (start >= end) return 0;

    let totalMs = 0;
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());

    const current = new Date(startDay);
    while (current.getTime() <= endDay.getTime()) {
      const hours = getWorkHoursForDay(current);
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

  // Helper to convert compressed working milliseconds back to a real Date
  const getDateFromWorkingMs = (start: Date, workingMs: number): Date => {
    if (workingMs <= 0) return new Date(start);

    let remainingMs = workingMs;
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const current = new Date(startDay);

    while (true) {
      const hours = getWorkHoursForDay(current);
      if (hours) {
        const workStart = new Date(current.getFullYear(), current.getMonth(), current.getDate(), hours.startHour, 0, 0, 0);
        const workEnd = new Date(current.getFullYear(), current.getMonth(), current.getDate(), hours.endHour, 0, 0, 0);

        const activeStart = Math.max(start.getTime(), workStart.getTime());
        if (activeStart < workEnd.getTime()) {
          const availableMsOnDay = workEnd.getTime() - activeStart;
          if (remainingMs <= availableMsOnDay) {
            return new Date(activeStart + remainingMs);
          }
          remainingMs -= availableMsOnDay;
        }
      }
      // move to next day midnight
      current.setDate(current.getDate() + 1);
      current.setHours(0, 0, 0, 0);
      // Safety break to prevent infinite loop
      if (current.getFullYear() > start.getFullYear() + 1) {
        break;
      }
    }
    return new Date(start.getTime() + workingMs); // fallback
  };

  // 2. Generate list of days covered by the chart to draw shaded background grids
  const getShadedDays = () => {
    const days: Array<{ startPct: number; endPct: number; isWorking: boolean; dateStr: string }> = [];
    const startDay = new Date(minTime.getFullYear(), minTime.getMonth(), minTime.getDate());
    const endDay = new Date(maxTime.getFullYear(), maxTime.getMonth(), maxTime.getDate());

    const d = new Date(startDay);
    while (d <= endDay) {
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
      const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0);

      const activeStart = dayStart < minTime ? minTime : dayStart;
      const activeEnd = dayEnd > maxTime ? maxTime : dayEnd;

      if (activeStart < activeEnd) {
        const working = isWorkingDay(d);
        const startPct = getPct(activeStart);
        const endPct = getPct(activeEnd);

        days.push({
          startPct,
          endPct,
          isWorking: working,
          dateStr: d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
        });
      }
      d.setDate(d.getDate() + 1);
    }
    return days;
  };

  // 3. Generate shift references shading for working days
  const getShadedShifts = () => {
    const shifts: Array<{ startPct: number; endPct: number; label: string }> = [];
    const startDay = new Date(minTime.getFullYear(), minTime.getMonth(), minTime.getDate());
    const endDay = new Date(maxTime.getFullYear(), maxTime.getMonth(), maxTime.getDate());

    const d = new Date(startDay);
    while (d <= endDay) {
      if (isWorkingDay(d)) {
        const s1Start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 7, 0, 0);
        const s1End = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 15, 0, 0);
        
        const s2Start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 14, 30, 0);
        const s2End = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 22, 0, 0);

        const activeS1Start = s1Start < minTime ? minTime : s1Start;
        const activeS1End = s1End > maxTime ? maxTime : s1End;
        if (activeS1Start < activeS1End) {
          shifts.push({
            startPct: getPct(activeS1Start),
            endPct: getPct(activeS1End),
            label: 'Turno 1 (7:00 - 15:00)'
          });
        }

        const activeS2Start = s2Start < minTime ? minTime : s2Start;
        const activeS2End = s2End > maxTime ? maxTime : s2End;
        if (activeS2Start < activeS2End) {
          shifts.push({
            startPct: getPct(activeS2Start),
            endPct: getPct(activeS2End),
            label: 'Turno 2 (14:30 - 22:00)'
          });
        }
      }
      d.setDate(d.getDate() + 1);
    }
    return shifts;
  };

  // 4. Generate visual segments and markers for each subprocess row
  const getSubprocessTimeline = (subprocessId: string) => {
    const records = batchTimes
      .filter((t) => t.id_t === subprocessId)
      .sort((a, b) => a.secuencia - b.secuencia);

    const segments: TimelineSegment[] = [];
    const markers: TimelineMarker[] = [];

    let lastEvent: { type: 'play' | 'stop'; time: Date } | null = null;

    for (const rec of records) {
      const hasPlay = rec.fecha_hora_play !== null && rec.fecha_hora_play !== undefined;
      const hasStop = rec.fecha_hora_stop !== null && rec.fecha_hora_stop !== undefined;

      const pTime = hasPlay ? parseNaiveDate(rec.fecha_hora_play!) : null;
      const sTime = hasStop ? parseNaiveDate(rec.fecha_hora_stop!) : null;

      if (hasPlay && hasStop) {
        if (lastEvent) {
          if (lastEvent.type === 'stop') {
            segments.push({
              start: lastEvent.time,
              end: pTime!,
              type: 'red',
              description: `Detenido: ${formatDuration(pTime!.getTime() - lastEvent.time.getTime())}`
            });
          } else if (lastEvent.type === 'play') {
            segments.push({
              start: lastEvent.time,
              end: pTime!,
              type: 'blank',
              description: 'Datos ambiguos (Play seguido de Play sin Stop)'
            });
          }
        }

        segments.push({
          start: pTime!,
          end: sTime!,
          type: 'green',
          description: `Activo: ${formatDuration(sTime!.getTime() - pTime!.getTime())}`
        });

        lastEvent = { type: 'stop', time: sTime! };

      } else if (hasPlay && !hasStop) {
        if (lastEvent) {
          if (lastEvent.type === 'stop') {
            segments.push({
              start: lastEvent.time,
              end: pTime!,
              type: 'red',
              description: `Detenido: ${formatDuration(pTime!.getTime() - lastEvent.time.getTime())}`
            });
          } else if (lastEvent.type === 'play') {
            segments.push({
              start: lastEvent.time,
              end: pTime!,
              type: 'blank',
              description: 'Datos ambiguos (Play seguido de Play sin Stop)'
            });
          }
        }

        lastEvent = { type: 'play', time: pTime! };

      } else if (!hasPlay && hasStop) {
        lastEvent = { type: 'stop', time: sTime! };
      }
    }

    // 2. Open Plays: only show an arrow marker at the exact play start, no bar
    if (lastEvent && lastEvent.type === 'play') {
      markers.push({ time: lastEvent.time, type: 'arrow', isOpen: true });
    }

    return { segments, markers };
  };

  // 5 & 6. Total Worked and Totals breakdown per subprocess (ONLY counting closed segments)
  const getSubprocessTotals = (subprocessId: string) => {
    const records = batchTimes.filter((t) => t.id_t === subprocessId);
    let totalWorkedMs = 0;
    let totalStopMs = 0;

    const sorted = [...records].sort((a, b) => a.secuencia - b.secuencia);
    let lastStop: Date | null = null;

    sorted.forEach((rec) => {
      const hasPlay = rec.fecha_hora_play !== null && rec.fecha_hora_play !== undefined;
      const hasStop = rec.fecha_hora_stop !== null && rec.fecha_hora_stop !== undefined;

      const pTime = hasPlay ? parseNaiveDate(rec.fecha_hora_play!) : null;
      const sTime = hasStop ? parseNaiveDate(rec.fecha_hora_stop!) : null;

      if (hasPlay && hasStop) {
        totalWorkedMs += sTime!.getTime() - pTime!.getTime();
        if (lastStop && pTime) {
          totalStopMs += getWorkingTimeBetween(lastStop, pTime);
        }
        lastStop = sTime;
      } else if (hasPlay && !hasStop) {
        if (lastStop && pTime) {
          totalStopMs += getWorkingTimeBetween(lastStop, pTime);
        }
        lastStop = null; // resets because it is open
      } else if (!hasPlay && hasStop) {
        lastStop = sTime;
      }
    });

    return {
      worked: formatDuration(totalWorkedMs),
      stop: formatDuration(totalStopMs),
    };
  };

  // Duration formatter helper
  const formatDuration = (ms: number): string => {
    const totalSecs = Math.floor(ms / 1000);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
    return `${mins}m ${secs}s`;
  };

  // Apply zoom centered at a given ratio (0.5 is middle, mouseX/width is mouse position)
  const applyZoomAtRatio = (zoomFactor: number, ratio = 0.5) => {
    const currentMinMs = minTime.getTime();
    const currentMaxMs = maxTime.getTime();
    const currentRange = currentMaxMs - currentMinMs;

    const anchorTimeMs = currentMinMs + ratio * currentRange;
    let newRange = currentRange / zoomFactor;

    const limitMinMs = baseRange.min.getTime() - 3600000;
    const limitMaxMs = baseRange.max.getTime() + 3600000;
    const maxAllowedDuration = limitMaxMs - limitMinMs;

    // Cap the range to the max allowed duration
    if (newRange > maxAllowedDuration) {
      newRange = maxAllowedDuration;
    }

    // Minimum range 1 second
    if (newRange < 1000) return;

    let newMinMs = anchorTimeMs - ratio * newRange;
    let newMaxMs = anchorTimeMs + (1 - ratio) * newRange;

    // Clamp bounds and preserve range size
    if (newMinMs < limitMinMs) {
      newMinMs = limitMinMs;
      newMaxMs = newMinMs + newRange;
    }
    if (newMaxMs > limitMaxMs) {
      newMaxMs = limitMaxMs;
      newMinMs = newMaxMs - newRange;
    }

    // Double check clamping
    if (newMinMs < limitMinMs) {
      newMinMs = limitMinMs;
    }

    setCustomRange({
      min: new Date(newMinMs),
      max: new Date(newMaxMs)
    });

    const baseRangeMs = baseRange.max.getTime() - baseRange.min.getTime();
    setZoom(baseRangeMs / (newMaxMs - newMinMs));
  };

  // Interactive controls zoom
  const zoomIn = () => applyZoomAtRatio(1.3, 0.5);
  const zoomOut = () => applyZoomAtRatio(1 / 1.3, 0.5);
  const resetZoom = () => {
    setCustomRange(null);
    setZoom(1);
  };

  // Dynamic axis ticks formatter (with standard 3-hour round interval on default zoom)
  const getTicks = () => {
    const ticks: Date[] = [];
    const rangeHours = rangeMs / 3600000;

    let stepHours = 3; // default
    if (rangeHours <= 1.5) {
      stepHours = 0.25; // every 15m
    } else if (rangeHours <= 4) {
      stepHours = 0.5; // every 30m
    } else if (rangeHours <= 12) {
      stepHours = 1; // every hour
    } else if (rangeHours <= 36) {
      stepHours = 3; // every 3 hours (default zoom)
    } else if (rangeHours <= 72) {
      stepHours = 6; // every 6 hours
    } else if (rangeHours <= 168) {
      stepHours = 12; // every 12 hours
    } else {
      stepHours = 24; // every 24 hours
    }

    const startOfDay = new Date(minTime.getFullYear(), minTime.getMonth(), minTime.getDate(), 0, 0, 0, 0);
    const stepMs = stepHours * 3600000;

    const diffMs = minTime.getTime() - startOfDay.getTime();
    if (diffMs > 0) {
      const skipSteps = Math.floor(diffMs / stepMs);
      startOfDay.setTime(startOfDay.getTime() + skipSteps * stepMs);
    }

    let current = new Date(startOfDay);
    while (current.getTime() <= maxTime.getTime() + 1000) {
      if (current.getTime() >= minTime.getTime() - 1000 && current.getTime() <= maxTime.getTime() + 1000) {
        const hours = getWorkHoursForDay(current);
        if (hours) {
          const h = current.getHours();
          if (h >= hours.startHour && h <= hours.endHour) {
            ticks.push(new Date(current));
          }
        }
      }
      current.setTime(current.getTime() + stepMs);
      if (ticks.length > 80) break;
    }

    if (ticks.length === 0) {
      const count = 6;
      const totalWorkingMs = getWorkingTimeBetween(minTime, maxTime);
      if (totalWorkingMs > 0) {
        for (let i = 0; i < count; i++) {
          const workingMsAtPoint = (totalWorkingMs * i) / (count - 1);
          ticks.push(getDateFromWorkingMs(minTime, workingMsAtPoint));
        }
      } else {
        for (let i = 0; i < count; i++) {
          ticks.push(new Date(minTime.getTime() + (rangeMs * i) / (count - 1)));
        }
      }
    }

    return ticks;
  };

  // Calculate day boundaries (midnight) in visible range for visual change-of-day highlight
  const getDayBoundaries = () => {
    const boundaries: Date[] = [];
    const startDay = new Date(minTime.getFullYear(), minTime.getMonth(), minTime.getDate());
    const endDay = new Date(maxTime.getFullYear(), maxTime.getMonth(), maxTime.getDate());

    const d = new Date(startDay);
    d.setDate(d.getDate() + 1); // transition to next midnight
    while (d <= endDay) {
      const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
      if (midnight.getTime() >= minTime.getTime() && midnight.getTime() <= maxTime.getTime()) {
        boundaries.push(midnight);
      }
      d.setDate(d.getDate() + 1);
    }
    return boundaries;
  };

  // Wheel zoom interaction handler (Ctrl + Wheel)
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (!gridRef.current) return;
      const rect = gridRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, x / rect.width));

      if (e.deltaY < 0) {
        applyZoomAtRatio(1.15, ratio);
      } else {
        applyZoomAtRatio(1 / 1.15, ratio);
      }
    }
  };

  // Drag mouse interaction handlers (Panning or Zoom-selection)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click
    if (!gridRef.current) return;
    const rect = gridRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;

    // Only initiate drag if cursor is over the grid timeline area (x >= 0)
    if (x >= 0) {
      setIsDragging(true);
      setDragStartX(e.clientX);
      dragStartMs.current = {
        min: minTime.getTime(),
        max: maxTime.getTime()
      };

      if (interactionMode === 'zoom-select') {
        const pct = (x / rect.width) * 100;
        setZoomStartPct(pct);
        setZoomCurrentPct(pct);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!gridRef.current) return;
    const rect = gridRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;

    // Track vertical hover line
    const y = e.clientY - rect.top;
    if (x >= 0 && x <= rect.width) {
      const pct = (x / rect.width) * 100;
      setHoverPct(pct);
      setHoverY(y);
      
      const totalWorkingMs = getWorkingTimeBetween(minTime, maxTime);
      const elapsedWorkingMs = (pct / 100) * totalWorkingMs;
      const hoverDate = getDateFromWorkingMs(minTime, elapsedWorkingMs);
      setHoverTime(hoverDate);
    } else {
      setHoverPct(null);
      setHoverTime(null);
      setHoverY(null);
    }

    // Handle Dragging
    if (isDragging && dragStartX !== null) {
      if (interactionMode === 'move' && dragStartMs.current) {
        const deltaX = e.clientX - dragStartX;
        const startRangeMs = dragStartMs.current.max - dragStartMs.current.min;
        const msPerPixel = startRangeMs / rect.width;
        const timeDelta = deltaX * msPerPixel;

        let newMinMs = dragStartMs.current.min - timeDelta;
        let newMaxMs = dragStartMs.current.max - timeDelta;

        const visibleDuration = startRangeMs;
        const limitMinMs = baseRange.min.getTime() - 3600000; // 1 hour margin
        const limitMaxMs = baseRange.max.getTime() + 3600000; // 1 hour margin

        if (newMinMs < limitMinMs) {
          newMinMs = limitMinMs;
          newMaxMs = newMinMs + visibleDuration;
        }
        if (newMaxMs > limitMaxMs) {
          newMaxMs = limitMaxMs;
          newMinMs = newMaxMs - visibleDuration;
        }

        setCustomRange({
          min: new Date(newMinMs),
          max: new Date(newMaxMs)
        });
      } else if (interactionMode === 'zoom-select' && zoomStartPct !== null) {
        const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
        setZoomCurrentPct(pct);
      }
    }
  };

  const handleMouseUp = () => {
    if (isDragging) {
      setIsDragging(false);
      setDragStartX(null);
      dragStartMs.current = null;

      if (interactionMode === 'zoom-select' && zoomStartPct !== null && zoomCurrentPct !== null) {
        const start = Math.min(zoomStartPct, zoomCurrentPct);
        const end = Math.max(zoomStartPct, zoomCurrentPct);

        // If selection span is at least 1.5% of the timeline
        if (end - start > 1.5) {
          const totalWorkingMs = getWorkingTimeBetween(minTime, maxTime);
          const startWorkingMs = (start / 100) * totalWorkingMs;
          const endWorkingMs = (end / 100) * totalWorkingMs;

          const selectionMin = getDateFromWorkingMs(minTime, startWorkingMs);
          const selectionMax = getDateFromWorkingMs(minTime, endWorkingMs);

          setCustomRange({
            min: selectionMin,
            max: selectionMax
          });

          const newRange = selectionMax.getTime() - selectionMin.getTime();
          const baseRangeMs = baseRange.max.getTime() - baseRange.min.getTime();
          setZoom(baseRangeMs / newRange);
        }
      }
    }
    setZoomStartPct(null);
    setZoomCurrentPct(null);
  };

  // Group processes and sub-phases (Requirement 5)
  const processGroups = useMemo(() => {
    const groups: GroupedSubprocess[] = [];

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

    batchSubprocesses.forEach((sp) => {
      const proceso = processNameOf(sp.etapa);
      const fase = faseNameOf(sp.etapa);
      const item = {
        id_t: sp.id_t,
        no_paso: sp.no_paso,
        etapa: sp.etapa,
        fase,
        sp
      };

      if (groups.length > 0 && groups[groups.length - 1].proceso === proceso) {
        groups[groups.length - 1].items.push(item);
      } else {
        groups.push({
          proceso,
          items: [item]
        });
      }
    });

    return groups;
  }, [batchSubprocesses]);

  // Helper to format gap labels (Requirement 1)
  const formatGapLabel = (start: Date, end: Date): string => {
    const daysDiff = (end.getTime() - start.getTime()) / (24 * 3600000);
    const optionsShort: Intl.DateTimeFormatOptions = { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false };
    const sStr = start.toLocaleString('es-ES', optionsShort);
    const eStr = end.toLocaleString('es-ES', optionsShort);
    if (daysDiff > 1.2) {
      return `No laboral: ${sStr} → ${eStr}`;
    }
    return `Salto nocturno: ${start.toLocaleTimeString('es-ES', {hour: '2-digit', minute:'2-digit'})} → ${end.toLocaleTimeString('es-ES', {hour: '2-digit', minute:'2-digit'})}`;
  };

  // Pre-calculate jump/break points where non-working segments collapse to zero space
  const getJumpPoints = useMemo(() => {
    const intervals: Array<{ start: Date; end: Date }> = [];
    const startDay = new Date(minTime.getFullYear(), minTime.getMonth(), minTime.getDate());
    const endDay = new Date(maxTime.getFullYear(), maxTime.getMonth(), maxTime.getDate());

    const d = new Date(startDay);
    while (d <= endDay) {
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
      const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);

      if (!isWorkingDay(d)) {
        intervals.push({ start: dayStart, end: dayEnd });
      } else {
        const hours = getWorkHoursForDay(d);
        if (hours) {
          const workStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hours.startHour, 0, 0, 0);
          const workEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hours.endHour, 0, 0, 0);

          if (dayStart < workStart) {
            intervals.push({ start: dayStart, end: workStart });
          }
          if (workEnd < dayEnd) {
            intervals.push({ start: workEnd, end: dayEnd });
          }
        } else {
          intervals.push({ start: dayStart, end: dayEnd });
        }
      }
      d.setDate(d.getDate() + 1);
    }

    if (intervals.length === 0) return [];

    intervals.sort((a, b) => a.start.getTime() - b.start.getTime());

    const merged: Array<{ start: Date; end: Date; label: string }> = [];
    let current = { start: new Date(intervals[0].start), end: new Date(intervals[0].end) };

    for (let i = 1; i < intervals.length; i++) {
      const next = intervals[i];
      if (next.start.getTime() <= current.end.getTime()) {
        if (next.end.getTime() > current.end.getTime()) {
          current.end = new Date(next.end);
        }
      } else {
        merged.push({
          start: current.start,
          end: current.end,
          label: formatGapLabel(current.start, current.end),
        });
        current = { start: new Date(next.start), end: new Date(next.end) };
      }
    }
    merged.push({
      start: current.start,
      end: current.end,
      label: formatGapLabel(current.start, current.end),
    });

    return merged
      .map((gap) => {
        const overlapStart = new Date(Math.max(minTime.getTime(), gap.start.getTime()));
        const overlapEnd = new Date(Math.min(maxTime.getTime(), gap.end.getTime()));

        if (overlapStart < overlapEnd) {
          const pct = getPct(overlapStart);
          return {
            pct,
            start: gap.start,
            end: gap.end,
            label: formatGapLabel(gap.start, gap.end),
          };
        }
        return null;
      })
      .filter((g): g is { pct: number; start: Date; end: Date; label: string } => g !== null);
  }, [minTime, maxTime, exceptions]);

  const shadedDays = getShadedDays();
  const shadedShifts = getShadedShifts();
  const timelineTicks = getTicks();
  const dayBoundaries = getDayBoundaries();

  // Calculate scrollbar thumb size and offset
  const getScrollbarProps = () => {
    const limitMinMs = baseRange.min.getTime() - 3600000;
    const limitMaxMs = baseRange.max.getTime() + 3600000;
    const totalRangeMs = limitMaxMs - limitMinMs;

    if (totalRangeMs <= 0) return { leftPct: 0, widthPct: 100 };

    const visibleMinMs = minTime.getTime();
    const visibleMaxMs = maxTime.getTime();
    const visibleRangeMs = visibleMaxMs - visibleMinMs;

    // What fraction of total is visible
    const widthPct = Math.max(5, Math.min(100, (visibleRangeMs / totalRangeMs) * 100));
    // Offset
    const leftPct = Math.max(0, Math.min(100 - widthPct, ((visibleMinMs - limitMinMs) / totalRangeMs) * 100));

    return { leftPct, widthPct };
  };

  const scrollProps = getScrollbarProps();

  return (
    <div 
      className={isFullScreen 
        ? "fixed inset-0 z-50 bg-white overflow-auto p-6 md:p-8 flex flex-col" 
        : "bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden"
      } 
      id={`gantt-chart-${lote}`}
    >
      {/* Chart Header Info */}
      <div className="px-6 py-4 bg-slate-50/50 border-b border-slate-200 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div>
          <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2 uppercase tracking-wide">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-900 animate-pulse" />
            {(() => {
              const loteInfo = lotesCargados?.find(l => (l.nro_lote || '').trim().toUpperCase() === (lote || '').trim().toUpperCase());
              return loteInfo ? `${lote} — ${loteInfo.producto}` : lote;
            })()}
          </h4>
          <p className="text-[11px] text-slate-400 font-mono mt-0.5 font-medium">
            Rango: {format24h(minTime)} ({minTime.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}) → {format24h(maxTime)} ({maxTime.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })})
          </p>
        </div>

        {/* Zoom Interactive Controls & Mode Toggle */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Full Screen Toggle Button */}
          <button
            onClick={() => setIsFullScreen(!isFullScreen)}
            className="p-2 hover:bg-slate-100 rounded-lg text-slate-700 transition-colors cursor-pointer flex items-center gap-1.5 border border-slate-200 shadow-3xs bg-white font-extrabold text-[11px]"
            title={isFullScreen ? "Salir de pantalla completa" : "Pantalla completa"}
          >
            {isFullScreen ? (
              <>
                <Minimize2 className="w-3.5 h-3.5 text-blue-600" />
                <span>Contraer</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5 text-slate-600" />
                <span>Pantalla Completa</span>
              </>
            )}
          </button>

          {/* Interaction Mode Switchers */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200 shadow-2xs">
            <button
              onClick={() => setInteractionMode('move')}
              className={`px-3 py-1 rounded-md text-[11px] font-extrabold transition-all flex items-center gap-1 cursor-pointer ${
                interactionMode === 'move'
                  ? 'bg-white text-blue-700 shadow-2xs border border-slate-200/50'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
              title="Modo Mover: Haz clic y arrastra sobre el diagrama para desplazarte horizontalmente"
            >
              <Move className="w-3 h-3" />
              <span>Desplazar</span>
            </button>
            <button
              onClick={() => setInteractionMode('zoom-select')}
              className={`px-3 py-1 rounded-md text-[11px] font-extrabold transition-all flex items-center gap-1 cursor-pointer ${
                interactionMode === 'zoom-select'
                  ? 'bg-white text-blue-700 shadow-2xs border border-slate-200/50'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
              title="Modo Zoom Selección: Haz clic y arrastra para dibujar un rectángulo de zoom"
            >
              <div className="w-3 h-3 border border-dashed border-current rounded-xs shrink-0" />
              <span>Zoom por Selección</span>
            </button>
          </div>

          {/* Standard Zoom Controls */}
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg border border-slate-200 shadow-2xs">
            <button 
              onClick={zoomOut}
              className="p-1 hover:bg-white rounded text-slate-700 transition-colors cursor-pointer text-[11px] font-bold flex items-center gap-1"
              title="Alejar Zoom"
            >
              <ZoomOut className="w-3.5 h-3.5" />
              <span>Alejar</span>
            </button>
            <span className="text-[10px] font-bold text-slate-500 px-1 font-mono">{Math.round(zoom * 100)}%</span>
            <button 
              onClick={zoomIn}
              className="p-1 hover:bg-white rounded text-slate-700 transition-colors cursor-pointer text-[11px] font-bold flex items-center gap-1"
              title="Acercar Zoom"
            >
              <ZoomIn className="w-3.5 h-3.5" />
              <span>Acercar</span>
            </button>
            {(customRange !== null || zoom !== 1) && (
              <button 
                onClick={resetZoom}
                className="p-1 hover:bg-white rounded text-slate-500 hover:text-slate-800 transition-colors cursor-pointer text-[10px] flex items-center gap-0.5"
                title="Restablecer escala original"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Restaurar</span>
              </button>
            )}
          </div>
          
          {/* Legend */}
          <div className="flex flex-wrap gap-3.5 text-[10px] sm:text-xs">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-2.5 bg-emerald-400/30 border border-emerald-500 rounded-xs" />
              <span className="text-slate-500 font-medium text-[11px]">Activo</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-2.5 bg-emerald-500/10 border border-dashed border-emerald-500/40 rounded-xs" />
              <span className="text-slate-500 font-medium text-[11px]">Abierto</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-2.5 bg-red-400/20 border-r border-red-500 rounded-xs" />
              <span className="text-slate-500 font-medium text-[11px]">Parado</span>
            </div>
          </div>
        </div>
      </div>

      {!hasRecords ? (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
          <div className="p-3 bg-amber-50 text-amber-500 rounded-2xl mb-3">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <h5 className="font-semibold text-slate-800 text-sm">Sin registros de tiempo</h5>
          <p className="text-slate-400 text-xs mt-1 max-w-sm">
            Este lote está registrado pero no posee ninguna entrada en la tabla <code className="font-mono bg-slate-50 px-1 py-0.5 rounded text-slate-600">registro_tiempos_2</code>.
          </p>
        </div>
      ) : (
        <div className={`overflow-auto border-t border-slate-100 relative ${isFullScreen ? 'flex-1 max-h-none' : 'max-h-[600px]'}`}>
          {/* Main Gantt Arena */}
          <div 
            className="min-w-[900px] p-6 relative select-none"
            onWheel={handleWheel}
          >
            
            {/* 1. Timeline Horizontal Axis (TICK HEADERS) */}
            <div className="sticky top-0 bg-white z-40 border-b border-slate-200/60 pb-2 pt-2 -mx-6 px-6 mb-4 flex items-center shadow-2xs">
              {/* Left spacer matching columns "Proceso" (w-36) and "Fase" (w-44) = 20rem */}
              <div className="w-[20rem] shrink-0 flex items-center pl-2">
                <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">Flujo de Proceso</span>
              </div>
              {/* Right relative timeline ticks area */}
              <div className="flex-1 relative h-7">
                {timelineTicks.map((tick, idx) => {
                  const pct = getPct(tick);
                  return (
                    <div
                      key={`tick-${idx}`}
                      className="absolute -translate-x-1/2 flex flex-col items-center font-mono"
                      style={{ left: `${pct}%` }}
                    >
                      <span className="text-[10px] font-bold text-slate-500">
                        {format24h(tick)}
                      </span>
                      <span className="text-[8px] text-slate-400 font-bold scale-90 whitespace-nowrap">
                        <strong className="font-extrabold text-slate-800 uppercase tracking-wider mr-0.5">
                          {['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][tick.getDay()]}
                        </strong>
                        {` ${tick.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`}
                      </span>
                      <div className="w-px h-1.5 bg-slate-200 mt-1" />
                    </div>
                  );
                })}

              </div>
            </div>

            {/* 2. Subprocess Grid Rows Container */}
            <div 
              className="relative border border-slate-200 rounded-xl overflow-hidden bg-white"
              onMouseMove={handleMouseMove}
              onMouseLeave={() => {
                setHoverPct(null);
                setHoverTime(null);
              }}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              style={{ cursor: isDragging ? (interactionMode === 'move' ? 'grabbing' : 'crosshair') : (interactionMode === 'move' ? 'grab' : 'crosshair') }}
            >
              
              {/* Background Grid Layer - shifted to match columns */}
              <div 
                ref={gridRef} 
                className="absolute inset-y-0 right-0 left-0 pointer-events-none" 
                style={{ left: '20rem' }}
              >
                
                {/* A. Non-working day shading */}
                {shadedDays.map((day, idx) => (
                  <div
                    key={`shaded-day-${idx}`}
                    className={`absolute inset-y-0 ${
                      day.isWorking ? 'bg-transparent' : 'bg-slate-100/40 border-x border-slate-200/20 pattern-grid'
                    }`}
                    style={{
                      left: `${day.startPct}%`,
                      width: `${day.endPct - day.startPct}%`
                    }}
                    title={day.isWorking ? '' : `Día no laboral: ${day.dateStr}`}
                  />
                ))}

                {/* B. Working Shifts Guide lines (faint shading) */}
                {shadedShifts.map((shift, idx) => (
                  <div
                    key={`shaded-shift-${idx}`}
                    className="absolute inset-y-0 bg-blue-500/[0.01] border-x border-dashed border-blue-500/[0.03]"
                    style={{
                      left: `${shift.startPct}%`,
                      width: `${shift.endPct - shift.startPct}%`
                    }}
                    title={shift.label}
                  />
                ))}

                {/* Draw fine grid lines for each tick */}
                {timelineTicks.map((tick, idx) => {
                  const pct = getPct(tick);
                  return (
                    <div
                      key={`gridline-${idx}`}
                      className="absolute inset-y-0 border-l border-blue-300/80"
                      style={{ left: `${pct}%` }}
                    />
                  );
                })}

                {/* Day Boundary Markers (Midnight) - Requirement 5 */}
                {dayBoundaries.map((boundary, idx) => {
                  const pct = getPct(boundary);
                  const isMonday = boundary.getDay() === 1;
                  return (
                    <div
                      key={`day-boundary-${idx}`}
                      className={`absolute inset-y-0 border-solid bg-blue-500/[0.02] ${
                        isMonday 
                          ? 'border-l-[5px] border-blue-600 z-10' 
                          : 'border-l-2 border-blue-600'
                      }`}
                      style={{ left: `${pct}%` }}
                      title={`Cambio de día: ${boundary.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}`}
                    >
                      {isWorkingDay(boundary) && (
                        <div className="absolute top-1 left-1.5 bg-slate-100/90 border border-slate-200 text-slate-500 font-mono text-[8px] font-semibold uppercase px-1 py-0.5 rounded shadow-2xs whitespace-nowrap z-20">
                          🌓 <strong className="font-extrabold text-slate-800 uppercase tracking-wider mr-0.5">{['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][boundary.getDay()]}</strong> {boundary.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Visual gap break lines across rows */}
                {getJumpPoints.map((jump, idx) => (
                  <div
                    key={`gap-line-${idx}`}
                    className="absolute inset-y-0 w-1 border-x border-dashed border-amber-300/40 bg-amber-500/[0.03] group/line cursor-help"
                    style={{ left: `${jump.pct}%` }}
                    title={jump.label}
                  >
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-amber-50 text-amber-600 border border-amber-200 font-extrabold text-[8px] px-0.5 py-0.2 rounded shadow-3xs opacity-40 group-hover/line:opacity-100 transition-opacity">
                      ‖
                    </div>
                  </div>
                ))}

                {/* Selection rectangle visual overlay - Requirement 2 */}
                {interactionMode === 'zoom-select' && isDragging && zoomStartPct !== null && zoomCurrentPct !== null && (
                  <div 
                    className="absolute inset-y-0 bg-blue-500/15 border-x-2 border-dashed border-blue-600 pointer-events-none z-20"
                    style={{
                      left: `${Math.min(zoomStartPct, zoomCurrentPct)}%`,
                      width: `${Math.abs(zoomCurrentPct - zoomStartPct)}%`
                    }}
                  />
                )}

                {/* 4. Mouse Follow Tooltip (Date + Time at cursor position) */}
                {hoverPct !== null && hoverTime !== null && hoverY !== null && (
                  <div 
                    className="absolute pointer-events-none z-40 bg-slate-900 text-white text-[10px] font-bold font-mono px-2 py-1 rounded-md shadow-lg whitespace-nowrap border border-slate-700"
                    style={{ 
                      left: `${hoverPct}%`, 
                      top: `${hoverY}px`,
                      transform: 'translate(12px, -50%)'
                    }}
                  >
                    {hoverTime.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} {format24h(hoverTime, true)}
                  </div>
                )}
              </div>

              {/* Rows layout grouped by Process - Requirement 5 & 6 */}
              {processGroups.map((group, gIdx) => {
                return (
                  <div 
                    key={`${group.proceso}-${gIdx}`} 
                    className={`flex divide-x divide-slate-200 bg-white ${
                      gIdx < processGroups.length - 1 ? 'border-b-[3px] border-slate-400' : ''
                    }`}
                  >
                    {/* Column 1: Proceso (Merged visually) */}
                    <div className="w-24 shrink-0 bg-slate-50/40 p-2 flex flex-col justify-center select-none">
                      <span className="text-[7.5px] font-extrabold text-slate-400 uppercase tracking-wider block mb-0.5">PROCESO</span>
                      <span className="text-[10px] font-black text-slate-700 leading-tight break-words uppercase">
                        {group.proceso}
                      </span>
                    </div>

                    {/* Column 2 & Timeline: Phases lists */}
                    <div className="flex-1">
                      {group.items.map(({ id_t, no_paso, fase, sp }, iIdx) => {
                        const { segments, markers } = getSubprocessTimeline(id_t);
                        const totals = getSubprocessTotals(id_t);
                        const isLastItem = iIdx === group.items.length - 1;

                        return (
                          <div 
                            key={id_t} 
                            id={`gantt-row-${id_t}`}
                            className={`flex items-center h-[42px] relative group hover:bg-slate-50/30 transition-colors ${
                              !isLastItem ? 'border-b border-slate-300' : ''
                            }`}
                          >
                            {/* Column 2: Fase */}
                            <div className="w-56 pr-2.5 pl-3 shrink-0 flex flex-col justify-center select-none border-r border-slate-200">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[8px] font-mono font-bold bg-slate-100 text-slate-500 px-1 py-0.2 rounded shrink-0">
                                  #{no_paso.toString().padStart(2, '0')}
                                </span>
                                <span className="text-[11px] font-bold text-slate-800 leading-tight truncate uppercase" title={fase}>
                                  {fase}
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-500 font-medium mt-0.5 flex items-center gap-2.5 truncate">
                                <div className="flex items-center gap-1 shrink-0">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                                  <span className="text-emerald-700 font-semibold">{totals.worked}</span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 inline-block" />
                                  <span className="text-rose-600 font-semibold">{totals.stop}</span>
                                </div>
                              </div>
                            </div>

                            {/* Timeline Track */}
                            <div className="flex-1 h-[36px] bg-slate-50/50 rounded-md border border-slate-200/40 relative overflow-hidden group-hover:bg-slate-50/80 transition-all mr-2">
                              {/* Active Segments Render */}
                              {segments.map((seg, sIdx) => {
                                const startPct = getPct(seg.start);
                                const endPct = getPct(seg.end);
                                const widthPct = endPct - startPct;

                                if (widthPct <= 0) return null;

                                let colorClass = '';
                                
                                if (seg.type === 'green') {
                                  if (seg.isOpen) {
                                    colorClass = 'bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/80 border-dashed text-emerald-800';
                                  } else {
                                    colorClass = 'bg-emerald-400/30 hover:bg-emerald-400/40 text-slate-800';
                                  }
                                } else if (seg.type === 'red') {
                                  colorClass = 'bg-red-400/15 hover:bg-red-400/25 text-slate-700';
                                } else {
                                  colorClass = 'bg-white border-x border-dashed border-slate-300 text-slate-500';
                                }

                                const exactTooltip = seg.isOpen 
                                  ? `Proceso en curso desde: ${format24h(seg.start)} (${seg.start.toLocaleDateString()})\nTiempo total transcurrido: ${formatDuration(currentTime.getTime() - seg.start.getTime())}`
                                  : `${seg.type === 'green' ? 'Activo' : seg.type === 'red' ? 'Detenido' : 'Ambiguo'}: ${formatDuration(seg.end.getTime() - seg.start.getTime())}\nInicio: ${format24h(seg.start)} (${seg.start.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })})\nFin: ${format24h(seg.end)} (${seg.end.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })})`;

                                return (
                                  <div
                                    key={`seg-${sIdx}`}
                                    className={`absolute inset-y-[1px] rounded-xs flex items-center justify-center transition-colors duration-150 text-[10px] font-bold px-2 cursor-pointer overflow-hidden ${colorClass}`}
                                    style={{
                                      left: `${startPct}%`,
                                      right: `${100 - endPct}%`,
                                      boxShadow: seg.type === 'green' && !seg.isOpen
                                        ? 'inset 0 0 0 1px #059669'
                                        : seg.type === 'red'
                                          ? 'inset 0 0 0 1px #dc2626'
                                          : undefined
                                    }}
                                    title={exactTooltip}
                                  >
                                    {widthPct > 8 && seg.type !== 'blank' && (
                                      <span className="truncate scale-90">
                                        {seg.isOpen ? formatDuration(currentTime.getTime() - seg.start.getTime()) : formatDuration(seg.end.getTime() - seg.start.getTime())}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}

                              {/* Event Markers Render */}
                              {markers.map((mark, mIdx) => {
                                const isOutside = mark.time > maxTime;
                                const pct = isOutside ? 100 : getPct(mark.time);

                                if (mark.type === 'red-line' && false) {
                                  return (
                                    <div
                                      key={`mark-${mIdx}`}
                                      className="absolute top-0 bottom-0 w-[1px] bg-red-500 z-10 hover:w-[2px] transition-all cursor-pointer"
                                      style={{ left: `${pct}%` }}
                                      title={`Marcador de STOP: ${format24h(mark.time)}`}
                                    />
                                  );
                                } else if (mark.type === 'arrow') {
                                  return (
                                    <div
                                      key={`mark-${mIdx}`}
                                      className="absolute top-0 bottom-0 flex items-center justify-center z-15"
                                      style={{ left: `calc(${pct}% - ${isOutside ? '10px' : '6px'})` }}
                                      title={isOutside ? 'En curso (continúa más allá del límite visible)' : 'En curso'}
                                    >
                                      <div className="border-y-[6px] border-y-transparent border-l-[10px] border-l-emerald-600"></div>
                                    </div>
                                  );
                                }
                                return null;
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {hasRecords && (
        <div className="px-6 pb-4 pt-2 bg-slate-50/40 border-t border-slate-150 flex items-center gap-3">
          <span className="text-[10px] font-extrabold text-slate-400 uppercase select-none font-sans tracking-wider w-[20rem] shrink-0 pl-2">
            Navegación de tiempo
          </span>
          <div 
            ref={scrollTrackRef}
            onClick={handleScrollTrackClick}
            className="flex-1 h-3.5 bg-slate-100 rounded-full border border-slate-200 relative cursor-pointer group hover:bg-slate-150/80 transition-colors"
          >
            <div
              onMouseDown={handleScrollThumbMouseDown}
              className="scrollbar-thumb absolute top-0.5 bottom-0.5 bg-slate-400 hover:bg-slate-500 rounded-full transition-colors shadow-2xs cursor-grab active:cursor-grabbing flex items-center justify-center"
              style={{
                left: `${scrollProps.leftPct}%`,
                width: `${scrollProps.widthPct}%`,
                minWidth: '32px'
              }}
            >
              <div className="flex gap-0.5 items-center justify-center opacity-40 group-hover:opacity-100 transition-opacity">
                <span className="w-1 h-1.5 bg-white rounded-full" />
                <span className="w-1 h-1.5 bg-white rounded-full" />
                <span className="w-1 h-1.5 bg-white rounded-full" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
