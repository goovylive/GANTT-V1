import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  console.log("Fetching data...");
  const { data: tareas } = await supabase.from('identificacion_tarea_2').select('*');
  const { data: registroTiempos } = await supabase.from('registro_tiempos').select('*');

  if (!tareas || !registroTiempos) {
    console.log("No data fetched");
    return;
  }

  const lotes = ['154-1ABY01', '154-1ABY02', '154-1MRY06', '154-1MYY03'];
  const checkedLotes = {
    '154-1ABY01': true,
    '154-1ABY02': true,
    '154-1MRY06': true,
    '154-1MYY03': true
  };

  const sortedLotes = [...lotes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  const activeLotes = sortedLotes.filter(l => checkedLotes[l]);

  console.log("Active Lotes:", activeLotes);

  // Grouped subprocesses calculation
  const upperLotes = lotes.map(l => (l || '').trim().toUpperCase());
  const relevantTareas = tareas.filter(t => t.nro_lote && upperLotes.includes((t.nro_lote || '').trim().toUpperCase()));

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

  const sorted = Array.from(uniqueMap.values()).sort((a, b) => a.no_paso - b.no_paso);

  const groups: { proceso: string; items: typeof sorted }[] = [];
  sorted.forEach(item => {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.proceso === item.proceso) {
      lastGroup.items.push(item);
    } else {
      groups.push({ proceso: item.proceso, items: [item] });
    }
  });

  console.log("\nGroups and items:");
  groups.forEach(g => {
    console.log(`Process: ${g.proceso}`);
    g.items.forEach(sub => {
      console.log(`  Sub-process: #${sub.no_paso} - ${sub.fase}`);
    });
  });

  console.log("\nSimulating loop...");
  groups.forEach((processGroup, pIdx) => {
    const totalSubprocesses = processGroup.items.length;
    const totalLotesCount = activeLotes.length;
    const processRowSpan = totalSubprocesses * totalLotesCount;

    processGroup.items.forEach((sub, sIdx) => {
      const subRowSpan = totalLotesCount;
      console.log(`\nRendering subprocess #${sub.no_paso} "${sub.fase}" with subRowSpan=${subRowSpan}`);

      activeLotes.forEach((lote, lIdx) => {
        const isFirstInProcess = sIdx === 0 && lIdx === 0;
        const isFirstInSub = lIdx === 0;

        console.log(`  Row for lote: ${lote} | isFirstInProcess=${isFirstInProcess} | isFirstInSub=${isFirstInSub}`);
      });
    });
  });
}

run();
