'use client'

import { useState, useEffect, useCallback } from 'react'
import { AttendanceRow, AttendanceFilters } from '@/lib/types'
import { MatrixData } from '@/lib/humand'
import { getFirstDayOfMonth, getTodayString } from '@/lib/utils'
import Filters from './Filters'
import KpiCards from './KpiCards'
import AttendanceTable from './AttendanceTable'
import MatrixView from './MatrixView'

const DEFAULT_FILTERS: AttendanceFilters = {
  fecha_inicio: getFirstDayOfMonth(),
  fecha_fin: getTodayString(),
  colaborador: '%',
}

const DEFAULT_MATRIX_FILTERS = {
  startDate: getFirstDayOfMonth(),
  endDate: getTodayString(),
  location: 'all',
  search: '',
}

function exportToCsv(rows: AttendanceRow[], filters: AttendanceFilters) {
  if (rows.length === 0) return
  const headers = Object.keys(rows[0]) as (keyof AttendanceRow)[]
  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      headers.map((h) => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(',')
    ),
  ]
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `asistencia_${filters.fecha_inicio}_${filters.fecha_fin}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

type Tab = 'registros' | 'matriz'

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>('registros')

  // Tab 1 — Registros (Redash)
  const [filters, setFilters] = useState<AttendanceFilters>(DEFAULT_FILTERS)
  const [rows, setRows] = useState<AttendanceRow[]>([])
  const [loadingRows, setLoadingRows] = useState(false)
  const [errorRows, setErrorRows] = useState<string | null>(null)
  const [lastFetchedRows, setLastFetchedRows] = useState<string | null>(null)

  // Tab 2 — Matriz (Humand API)
  const [matrixFilters, setMatrixFilters] = useState(DEFAULT_MATRIX_FILTERS)
  const [matrixData, setMatrixData] = useState<MatrixData | null>(null)
  const [loadingMatrix, setLoadingMatrix] = useState(false)
  const [errorMatrix, setErrorMatrix] = useState<string | null>(null)

  const fetchRows = useCallback(async (f: AttendanceFilters) => {
    setLoadingRows(true)
    setErrorRows(null)
    try {
      const params = new URLSearchParams({ fecha_inicio: f.fecha_inicio, fecha_fin: f.fecha_fin, colaborador: f.colaborador })
      const res = await fetch(`/api/humand/daily?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al cargar datos')
      setRows(data.rows)
      setLastFetchedRows(new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }))
    } catch (err) {
      setErrorRows(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoadingRows(false)
    }
  }, [])

  const fetchMatrix = useCallback(async (f: typeof DEFAULT_MATRIX_FILTERS) => {
    setLoadingMatrix(true)
    setErrorMatrix(null)
    try {
      const params = new URLSearchParams({ startDate: f.startDate, endDate: f.endDate })
      const res = await fetch(`/api/humand/matrix?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al cargar matriz')
      setMatrixData(data)
    } catch (err) {
      setErrorMatrix(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoadingMatrix(false)
    }
  }, [])

  // Load Tab 1 on mount
  useEffect(() => { fetchRows(DEFAULT_FILTERS) }, [fetchRows])

  const tabs: { id: Tab; label: string; icon: string; description: string }[] = [
    {
      id: 'registros',
      label: 'Registros Diarios',
      icon: '📋',
      description: 'Detalle de entradas/salidas por colaborador · API Humand',
    },
    {
      id: 'matriz',
      label: 'Vista Matriz',
      icon: '📊',
      description: 'Calendario visual por sucursal · API Humand',
    },
  ]

  const isLoading = tab === 'registros' ? loadingRows : loadingMatrix

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20 shadow-sm">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">
              GC
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900">Farmacias GC</h1>
              <p className="text-xs text-gray-500">Control de Asistencia</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {tab === 'registros' && lastFetchedRows && (
              <span className="text-xs text-gray-400">Actualizado {lastFetchedRows}</span>
            )}
            <button
              onClick={() => tab === 'registros' ? fetchRows(filters) : fetchMatrix(matrixFilters)}
              disabled={isLoading}
              title="Actualizar datos"
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 disabled:opacity-30 transition-colors"
            >
              <svg className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6">
          <div className="flex gap-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTab(t.id)
                  if (t.id === 'matriz' && !matrixData && !loadingMatrix) {
                    fetchMatrix(matrixFilters)
                  }
                }}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-emerald-500 text-emerald-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
                <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-normal">
                  Humand API
                </span>
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6">
        {/* Tab 1 — Registros */}
        {tab === 'registros' && (
          <div className="space-y-4">
            <Filters
              filters={filters}
              onApply={(f) => {
                setFilters(f)
                fetchRows(f)
                // Sync date range to Matrix so both views stay aligned
                setMatrixFilters((prev) => ({ ...prev, startDate: f.fecha_inicio, endDate: f.fecha_fin }))
              }}
              loading={loadingRows}
            />

            {errorRows ? (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                <svg className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-red-800">Error al cargar datos</p>
                  <p className="text-xs text-red-600 mt-0.5">{errorRows}</p>
                  <button onClick={() => fetchRows(filters)} className="mt-2 text-xs text-red-700 underline hover:no-underline">
                    Reintentar
                  </button>
                </div>
              </div>
            ) : loadingRows ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 h-24 animate-pulse">
                      <div className="h-3 bg-gray-200 rounded w-1/2 mb-3" />
                      <div className="h-7 bg-gray-200 rounded w-3/4" />
                    </div>
                  ))}
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-10 flex flex-col items-center gap-3 text-gray-400">
                  <svg className="animate-spin h-8 w-8 text-emerald-500" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <p className="text-sm">Consultando datos de asistencia...</p>
                </div>
              </div>
            ) : (
              <>
                <KpiCards rows={rows} />
                <AttendanceTable rows={rows} onExportCsv={() => exportToCsv(rows, filters)} />
              </>
            )}
          </div>
        )}

        {/* Tab 2 — Matriz */}
        {tab === 'matriz' && (
          <MatrixView
            matrixData={matrixData}
            loading={loadingMatrix}
            error={errorMatrix}
            filters={matrixFilters}
            onFiltersChange={(f) => {
              setMatrixFilters(f)
              // Sync date range to Registros so both views stay aligned
              setFilters((prev) => ({ ...prev, fecha_inicio: f.startDate, fecha_fin: f.endDate }))
            }}
            onFetch={fetchMatrix}
          />
        )}
      </main>
    </div>
  )
}
