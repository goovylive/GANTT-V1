import { createClient } from '@supabase/supabase-js';

// Read from environment variables with safe casting
const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || '';
const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// Lazy initialization of the Supabase client
let supabaseInstance: ReturnType<typeof createClient> | null = null;

export function getSupabaseClient() {
  if (!isSupabaseConfigured) {
    return null;
  }
  if (!supabaseInstance) {
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey);
  }
  return supabaseInstance;
}

// Types matching the Supabase tables
export interface IdentificacionTarea {
  id_t: string;
  nro_lote: string;
  id_prd_lin: string;
  etapa: string;
  paso: string;
  no_paso: number;
  tiempo_estandar: number | null;
}

export interface RegistroTiempos {
  id_t: string;
  secuencia: number;
  fecha_hora_play: string | null;
  fecha_hora_stop: string | null;
  no_paso: number;
  tiempo_parada: string | null;
}

export function parseIntervalToMs(interval: string | null): number {
  if (!interval) return 0;

  let days = 0;
  const dayMatch = interval.match(/(-?\d+)\s+day[s]?/);
  if (dayMatch) {
    days = parseInt(dayMatch[1], 10);
  }

  const timeMatch = interval.match(/(-?\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!timeMatch) return days * 86400000;

  const hours = parseInt(timeMatch[1], 10);
  const minutes = parseInt(timeMatch[2], 10);
  const seconds = parseFloat(timeMatch[3]);

  const sign = interval.trim().startsWith('-') ? -1 : 1;

  return (
    days * 86400000 +
    sign * (Math.abs(hours) * 3600000 + minutes * 60000 + seconds * 1000)
  );
}

export interface ExcepcionLaboral {
  fecha: string; // YYYY-MM-DD
  es_laboral: boolean;
}

export interface LoteCargado {
  nro_lote: string;
  producto: string;
}

