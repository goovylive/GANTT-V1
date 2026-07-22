import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  const { data: tareas } = await supabase.from('identificacion_tarea_2').select('*');
  if (!tareas) return;
  
  const uniqueLotes = Array.from(new Set(tareas.map(t => t.nro_lote).filter(Boolean)));
  const esteriles = uniqueLotes.filter(l => !l.includes('-'));
  
  console.log("Esteriles lotes and products:");
  esteriles.forEach(lote => {
    const matches = tareas.filter(t => t.nro_lote === lote);
    const prdCode = matches[0]?.id_prd_lin;
    console.log(`Lote: ${lote} | Product Code: ${prdCode} | Total tasks: ${matches.length}`);
  });
}

run();
