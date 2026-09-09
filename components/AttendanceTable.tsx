'use client'

import { useState, useMemo } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  SortingState,
  ColumnDef,
} from '@tanstack/react-table'
import { AttendanceRow } from '@/lib/types'
import { rowHasAutoClose, rowIsAbsent, formatHours } from '@/lib/utils'
import MethodBadge from './MethodBadge'

interface Props {
  rows: AttendanceRow[]
  onExportCsv: () => void
}

const TIME_CELL = (v: string | null) =>
  v ? <span className="font-mono text-sm">{v}</span> : <span className="text-gray-300">—</span>

function RowStatusDot({ row }: { row: AttendanceRow }) {
  if (row.Feriado) return <span title={row.Feriado} className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1" />
  if (row.Licencia) return <span title={row.Licencia} className="inline-block w-2 h-2 rounded-full bg-violet-500 mr-1" />
  if (rowIsAbsent(row)) return <span title="Ausente" className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1" />
  if (rowHasAutoClose(row)) return <span title="Auto-cierre" className="inline-block w-2 h-2 rounded-full bg-orange-400 mr-1" />
  return null
}

export default function AttendanceTable({ rows, onExportCsv }: Props) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')

  const columns = useMemo<ColumnDef<AttendanceRow>[]>(() => [
    {
      id: 'status',
      header: '',
      size: 28,
      enableSorting: false,
      cell: ({ row }) => <RowStatusDot row={row.original} />,
    },
    {
      accessorKey: 'Fecha',
      header: 'Fecha',
      size: 90,
      cell: ({ getValue }) => {
        const v = getValue<string>()
        if (!v) return '—'
        const [y, m, d] = v.split('-')
        return <span className="font-mono text-sm">{`${d}/${m}/${y.slice(2)}`}</span>
      },
    },
    {
      accessorKey: 'Día',
      header: 'Día',
      size: 90,
    },
    {
      accessorKey: 'Colaborador',
      header: 'Colaborador',
      size: 180,
      cell: ({ getValue }) => (
        <span className="font-medium text-gray-900">{getValue<string>()}</span>
      ),
    },
    {
      id: 'hr-prog-ent',
      accessorFn: (r) => r['Hr. Prog. Ent.'],
      header: 'Prog. Ent.',
      size: 80,
      cell: ({ getValue }) => TIME_CELL(getValue<string | null>()),
    },
    {
      id: 'hr-prog-sal',
      accessorFn: (r) => r['Hr. Prog. Sal.'],
      header: 'Prog. Sal.',
      size: 80,
      cell: ({ getValue }) => TIME_CELL(getValue<string | null>()),
    },
    {
      id: 'ent-1',
      accessorFn: (r) => r['Ent. 1'],
      header: 'Ent. 1',
      size: 70,
      cell: ({ getValue }) => TIME_CELL(getValue<string | null>()),
    },
    {
      id: 'sal-1',
      accessorFn: (r) => r['Sal. 1'],
      header: 'Sal. 1',
      size: 70,
      cell: ({ getValue }) => TIME_CELL(getValue<string | null>()),
    },
    {
      id: 'ent-2',
      accessorFn: (r) => r['Ent. 2'],
      header: 'Ent. 2',
      size: 70,
      cell: ({ getValue }) => TIME_CELL(getValue<string | null>()),
    },
    {
      id: 'sal-2',
      accessorFn: (r) => r['Sal. 2'],
      header: 'Sal. 2',
      size: 70,
      cell: ({ getValue }) => TIME_CELL(getValue<string | null>()),
    },
    {
      accessorKey: 'Almuerzo',
      header: 'Almuerzo',
      size: 80,
      cell: ({ getValue }) => TIME_CELL(getValue<string | null>()),
    },
    {
      id: 'hrs-trab',
      accessorFn: (r) => r['Hrs. Trab.'],
      header: 'Hrs. Trab.',
      size: 90,
      cell: ({ getValue }) => {
        const v = getValue<string | null>()
        if (!v) return <span className="text-gray-300">—</span>
        return <span className="font-semibold text-gray-900">{formatHours(v)}</span>
      },
    },
    {
      id: 'met-ent-1',
      accessorFn: (r) => r['Mét. Ent. 1'],
      header: 'Mét. Ent. 1',
      size: 100,
      cell: ({ getValue }) => <MethodBadge source={getValue<string | null>()} />,
    },
    {
      id: 'met-sal-1',
      accessorFn: (r) => r['Mét. Sal. 1'],
      header: 'Mét. Sal. 1',
      size: 100,
      cell: ({ getValue }) => <MethodBadge source={getValue<string | null>()} />,
    },
    {
      id: 'met-ent-2',
      accessorFn: (r) => r['Mét. Ent. 2'],
      header: 'Mét. Ent. 2',
      size: 100,
      cell: ({ getValue }) => <MethodBadge source={getValue<string | null>()} />,
    },
    {
      id: 'met-sal-2',
      accessorFn: (r) => r['Mét. Sal. 2'],
      header: 'Mét. Sal. 2',
      size: 120,
      cell: ({ getValue }) => <MethodBadge source={getValue<string | null>()} />,
    },
    {
      accessorKey: 'Feriado',
      header: 'Feriado',
      size: 120,
      cell: ({ getValue }) => {
        const v = getValue<string | null>()
        return v ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
            {v}
          </span>
        ) : <span className="text-gray-300">—</span>
      },
    },
    {
      accessorKey: 'Licencia',
      header: 'Licencia',
      size: 140,
      cell: ({ getValue }) => {
        const v = getValue<string | null>()
        return v ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-violet-100 text-violet-800 border border-violet-200">
            {v}
          </span>
        ) : <span className="text-gray-300">—</span>
      },
    },
  ], [])

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 50 } },
  })

  const { pageIndex, pageSize } = table.getState().pagination
  const totalFiltered = table.getFilteredRowModel().rows.length

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Filtrar en tabla..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-52 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
          <span className="text-xs text-gray-400">
            {totalFiltered.toLocaleString()} registros
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
              Ausente
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-orange-400 inline-block" />
              Auto-cierre
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
              Feriado
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-violet-500 inline-block" />
              Licencia
            </span>
          </div>
          <button
            onClick={onExportCsv}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Exportar CSV
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="bg-gray-50 border-b border-gray-200">
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    style={{ width: h.getSize() }}
                    className={`px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap ${
                      h.column.getCanSort() ? 'cursor-pointer hover:bg-gray-100 select-none' : ''
                    }`}
                    onClick={h.column.getToggleSortingHandler()}
                  >
                    <span className="flex items-center gap-1">
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getIsSorted() === 'asc' && <span className="text-emerald-600">↑</span>}
                      {h.column.getIsSorted() === 'desc' && <span className="text-emerald-600">↓</span>}
                    </span>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-gray-100">
            {table.getRowModel().rows.map((row) => {
              const r = row.original
              const rowClass = r.Feriado
                ? 'bg-blue-50/60'
                : r.Licencia
                ? 'bg-violet-50/60'
                : rowIsAbsent(r)
                ? 'bg-red-50/60'
                : rowHasAutoClose(r)
                ? 'bg-orange-50/60'
                : 'bg-white'

              return (
                <tr key={row.id} className={`${rowClass} hover:brightness-95 transition-all`}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2 whitespace-nowrap text-gray-700">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>

        {table.getRowModel().rows.length === 0 && (
          <div className="py-16 text-center text-gray-400">
            <svg className="mx-auto h-10 w-10 mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-sm">Sin registros para los filtros seleccionados</p>
          </div>
        )}
      </div>

      {totalFiltered > 0 && (
        <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
          <span className="text-xs text-gray-500">
            Mostrando {pageIndex * pageSize + 1}–{Math.min((pageIndex + 1) * pageSize, totalFiltered)} de {totalFiltered.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
              className="px-2 py-1 text-xs border rounded disabled:opacity-30 hover:bg-gray-100 disabled:cursor-not-allowed"
            >«</button>
            <button
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="px-2 py-1 text-xs border rounded disabled:opacity-30 hover:bg-gray-100 disabled:cursor-not-allowed"
            >‹</button>
            <span className="px-3 py-1 text-xs text-gray-600">
              Pág. {pageIndex + 1} / {table.getPageCount()}
            </span>
            <button
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="px-2 py-1 text-xs border rounded disabled:opacity-30 hover:bg-gray-100 disabled:cursor-not-allowed"
            >›</button>
            <button
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
              className="px-2 py-1 text-xs border rounded disabled:opacity-30 hover:bg-gray-100 disabled:cursor-not-allowed"
            >»</button>
          </div>
          <select
            value={pageSize}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
            className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none"
          >
            {[25, 50, 100, 200].map((n) => (
              <option key={n} value={n}>{n} por página</option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}
