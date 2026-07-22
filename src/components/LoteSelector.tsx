import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Layers, Check, ChevronDown, Search, Calendar } from 'lucide-react';
import { LoteCargado, IdentificacionTarea } from '../supabaseClient';

interface LoteSelectorProps {
  allLotes: string[];
  selectedLotes: string[];
  onChange: (lotes: string[]) => void;
  isLoading: boolean;
  lotesCargados?: LoteCargado[];
  tareas?: IdentificacionTarea[];
  isCalendarOpen?: boolean;
  onToggleCalendar?: () => void;
}

export default function LoteSelector({
  allLotes,
  selectedLotes,
  onChange,
  isLoading,
  lotesCargados = [],
  tareas = [],
  isCalendarOpen = false,
  onToggleCalendar
}: LoteSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Reset search term when dropdown closes or opens
  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
    }
  }, [isOpen]);

  const toggleLote = (lote: string) => {
    if (selectedLotes.includes(lote)) {
      onChange(selectedLotes.filter((item) => item !== lote));
    } else {
      onChange([...selectedLotes, lote]);
    }
  };

  const selectAll = () => {
    onChange([...allLotes]);
  };

  const selectNone = () => {
    onChange([]);
  };

  // Label text when the dropdown is closed
  const triggerLabel = useMemo(() => {
    if (selectedLotes.length === 0) {
      return 'Ningún lote seleccionado';
    }
    if (allLotes.length > 0 && selectedLotes.length === allLotes.length) {
      return 'Todos los lotes seleccionados';
    }
    return `${selectedLotes.length} ${selectedLotes.length === 1 ? 'lote seleccionado' : 'lotes seleccionados'}`;
  }, [selectedLotes, allLotes]);

  // Filter batches in real time by lote code, product code, and product description
  const filteredLotes = useMemo(() => {
    if (!searchTerm.trim()) return allLotes;
    const term = searchTerm.toLowerCase();
    return allLotes.filter((lote) => {
      const prodCode = tareas?.find((t) => t.nro_lote === lote)?.id_prd_lin || '';
      const prodName = lotesCargados.find((lc) => lc.nro_lote === lote)?.producto || '';
      return (
        lote.toLowerCase().includes(term) ||
        prodCode.toLowerCase().includes(term) ||
        prodName.toLowerCase().includes(term)
      );
    });
  }, [allLotes, searchTerm, tareas, lotesCargados]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm mb-6" id="lote-selector-container">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-slate-100 rounded-lg text-slate-700">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-950">Selección de Lotes</h3>
            <p className="text-xs text-slate-500 font-medium">Filtra y visualiza sus diagramas de Gantt en pestañas independientes</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 text-xs">
          {onToggleCalendar && (
            <button
              onClick={onToggleCalendar}
              className={`flex items-center gap-1.5 font-bold px-3 py-1.5 rounded-lg transition-all cursor-pointer border ${
                isCalendarOpen
                  ? 'bg-slate-900 text-white border-slate-900 shadow-3xs'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200 shadow-3xs'
              }`}
              title="Calendario Laboral"
              id="calendar-toggle-btn"
            >
              <Calendar className="w-3.5 h-3.5 shrink-0" />
              <span>Calendario Laboral</span>
            </button>
          )}
          <button
            onClick={selectAll}
            className="text-slate-900 hover:text-black font-semibold bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-all cursor-pointer"
            disabled={isLoading || allLotes.length === 0}
          >
            Seleccionar todos
          </button>
          <button
            onClick={selectNone}
            className="text-slate-500 hover:text-slate-800 font-semibold bg-slate-50 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-all cursor-pointer"
            disabled={isLoading}
          >
            Limpiar selección
          </button>
        </div>
      </div>

      <div className="mt-4 relative" ref={dropdownRef}>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 py-2.5 animate-pulse">
            <div className="w-4 h-4 rounded-full border-2 border-slate-800 border-t-transparent animate-spin" />
            Cargando lotes disponibles...
          </div>
        ) : allLotes.length === 0 ? (
          <div className="text-sm text-slate-400 py-4 text-center border-2 border-dashed border-slate-200 rounded-xl">
            No se encontraron lotes disponibles en la base de datos.
          </div>
        ) : (
          <div>
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="w-full sm:w-96 flex items-center justify-between gap-3 px-4 py-2.5 bg-white border border-slate-200 hover:border-slate-300 rounded-lg text-sm font-semibold text-slate-800 hover:text-slate-950 shadow-2xs transition-all cursor-pointer"
            >
              <span className="flex items-center gap-2 truncate">
                <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse shrink-0" />
                <span className="truncate">{triggerLabel}</span>
              </span>
              <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-250 shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown options */}
            {isOpen && (
              <div className="absolute left-0 mt-2 w-full sm:w-115 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-80 flex flex-col overflow-hidden">
                {/* Search Input Field */}
                <div className="p-2.5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
                  <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar por lote, código o nombre de producto..."
                    className="w-full bg-white border border-slate-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-800 placeholder-slate-400"
                    onClick={(e) => e.stopPropagation()} // Prevent closing dropdown
                    autoFocus
                  />
                </div>

                <div className="overflow-y-auto p-2 space-y-0.5 flex-1 max-h-56">
                  {filteredLotes.length === 0 ? (
                    <div className="text-xs text-slate-400 py-4 text-center font-medium">
                      No se encontraron resultados
                    </div>
                  ) : (
                    filteredLotes.map((lote) => {
                      const isSelected = selectedLotes.includes(lote);
                      const prodName = lotesCargados.find((lc) => lc.nro_lote === lote)?.producto || '';
                      const displayText = prodName ? `${lote} — ${prodName}` : lote;
                      return (
                        <button
                          key={lote}
                          onClick={() => toggleLote(lote)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all text-left cursor-pointer ${
                            isSelected ? 'bg-blue-50 text-blue-700 font-bold' : 'hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          <div className={`w-4 h-4 rounded-md flex items-center justify-center border shrink-0 transition-all ${
                            isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300'
                          }`}>
                            {isSelected && <Check className="w-2.5 h-2.5 stroke-[3.5]" />}
                          </div>
                          <span className="font-mono truncate" title={displayText}>{displayText}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
