'use client'

import { useState, useEffect } from 'react'
import { AttendanceFilters, ColaboradorOption } from '@/lib/types'
import { getTodayString, getFirstDayOfMonth, subtractDays } from '@/lib/utils'

interface Props {
  filters: AttendanceFilters
  onApply: (f: AttendanceFilters) => void
  loading: boolean
}

const QUICK_RANGES = [
  { label: 'Este mes', getRange: () => ({ inicio: getFirstDayOfMonth(), fin: getTodayString() }) },
  { label: 'Últimos 7 días', getRange: () => ({ inicio: subtractDays(6), fin: getTodayString() }) },
  { label: 'Últimos 14 días', getRange: () => ({ inicio: subtractDays(13), fin: getTodayString() }) },
  { label: 'Últimos 30 días', getRange: () => ({ inicio: subtractDays(29), fin: getTodayString() }) },
]

export default function Filters({ filters, onApply, loading }: Props) {
  const [local, setLocal] = useState(filters)

  // Keep local dates in sync when parent updates them (e.g. synced from Matrix view)
  useEffect(() => {
    setLocal((prev) => ({ ...prev, fecha_inicio: filters.fecha_inicio, fecha_fin: filters.fecha_fin }))
  }, [filters.fecha_inicio, filters.fecha_fin])
  const [colaboradores, setColaboradores] = useState<ColaboradorOption[]>([])
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    fetch('/api/colaboradores')
      .then((r) => r.json())
      .then((d) => d.options && setColaboradores(d.options))
      .catch(() => {})
  }, [])

  const filtered = colaboradores.filter((c) =>
    c.label.toLowerCase().includes(search.toLowerCase())
  )

  const selectedLabel =
    local.colaborador === '%'
      ? 'Todos los colaboradores'
      : (colaboradores.find((c) => c.name === local.colaborador)?.label ?? local.colaborador)

  function handleQuick(inicio: string, fin: string) {
    const next = { ...local, fecha_inicio: inicio, fecha_fin: fin }
    setLocal(next)
    onApply(next)
  }

  function handleApply() {
    onApply(local)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-gray-500 font-medium">Rango rápido:</span>
        {QUICK_RANGES.map((q) => {
          const { inicio, fin } = q.getRange()
          return (
            <button
              key={q.label}
              onClick={() => handleQuick(inicio, fin)}
              className="text-xs px-3 py-1 rounded-full border border-gray-200 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 transition-colors"
            >
              {q.label}
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Fecha inicio</label>
          <input
            type="date"
            value={local.fecha_inicio}
            onChange={(e) => setLocal({ ...local, fecha_inicio: e.target.value })}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Fecha fin</label>
          <input
            type="date"
            value={local.fecha_fin}
            onChange={(e) => setLocal({ ...local, fecha_fin: e.target.value })}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
          />
        </div>

        <div className="relative">
          <label className="block text-xs font-medium text-gray-600 mb-1">Colaborador</label>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="min-w-52 flex items-center justify-between border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white hover:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          >
            <span className="truncate max-w-48">{selectedLabel}</span>
            <svg className="ml-2 h-4 w-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {open && (
            <div className="absolute z-30 mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
              <div className="p-2 border-b border-gray-100">
                <input
                  autoFocus
                  type="text"
                  placeholder="Buscar colaborador..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>
              <ul className="max-h-56 overflow-y-auto text-sm">
                {filtered.map((c) => (
                  <li key={c.name}>
                    <button
                      type="button"
                      className={`w-full text-left px-4 py-2 hover:bg-emerald-50 transition-colors ${
                        local.colaborador === c.name ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-gray-700'
                      }`}
                      onClick={() => {
                        setLocal({ ...local, colaborador: c.name })
                        setOpen(false)
                        setSearch('')
                      }}
                    >
                      {c.label}
                    </button>
                  </li>
                ))}
                {filtered.length === 0 && (
                  <li className="px-4 py-3 text-gray-400 text-xs">Sin resultados</li>
                )}
              </ul>
            </div>
          )}
        </div>

        <button
          onClick={handleApply}
          disabled={loading}
          className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2"
        >
          {loading ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Cargando...
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Buscar
            </>
          )}
        </button>
      </div>
    </div>
  )
}
