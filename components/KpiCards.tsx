'use client'

import { AttendanceRow } from '@/lib/types'
import { rowHasAutoClose, rowIsAbsent } from '@/lib/utils'

interface Props {
  rows: AttendanceRow[]
}

export default function KpiCards({ rows }: Props) {
  // Exclude absent rows from "Registros" count (they have no clock-in)
  const rowsWithEntries = rows.filter((r) => r['Ent. 1'])
  const totalRegistros = rowsWithEntries.length
  const colaboradores = new Set(rowsWithEntries.map((r) => r.Colaborador)).size
  const autoCierres = rowsWithEntries.filter(rowHasAutoClose).length
  const conAusente = rows.filter(rowIsAbsent).length
  const conFeriado = rows.filter((r) => r.Feriado).length
  const conLicencia = rows.filter((r) => r.Licencia).length

  const cards = [
    {
      label: 'Registros',
      value: totalRegistros.toLocaleString(),
      sub: `${colaboradores} colaborador${colaboradores !== 1 ? 'es' : ''}`,
      icon: '📋',
      color: 'border-l-blue-500',
    },
    {
      label: 'Auto-cierres',
      value: autoCierres.toLocaleString(),
      sub: totalRegistros > 0 ? `${((autoCierres / totalRegistros) * 100).toFixed(1)}% del total` : '',
      icon: '🔄',
      color: 'border-l-orange-500',
    },
    {
      label: 'Ausencias',
      value: (conAusente + conFeriado + conLicencia).toLocaleString(),
      sub: `${conAusente} ausentes · ${conFeriado} feriados · ${conLicencia} licencias`,
      icon: '📅',
      color: 'border-l-red-500',
    },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {cards.map((c) => (
        <div key={c.label} className={`bg-white rounded-xl border border-gray-200 border-l-4 ${c.color} p-4 shadow-sm`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{c.label}</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{c.value}</p>
              {c.sub && <p className="mt-0.5 text-xs text-gray-500">{c.sub}</p>}
            </div>
            <span className="text-2xl">{c.icon}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
