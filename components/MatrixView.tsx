'use client'

import { useState, useMemo, useRef } from 'react'
import * as XLSX from 'xlsx'
import { MatrixData, MatrixDay, MatrixEmployee } from '@/lib/humand'
import { getFirstDayOfMonth, getTodayString, subtractDays } from '@/lib/utils'

const WEEKDAY_ES: Record<string, string> = {
  MONDAY: 'L', TUESDAY: 'M', WEDNESDAY: 'X', THURSDAY: 'J',
  FRIDAY: 'V', SATURDAY: 'S', SUNDAY: 'D',
}

const WEEKDAY_FULL: Record<string, string> = {
  MONDAY: 'Lunes', TUESDAY: 'Martes', WEDNESDAY: 'Miércoles',
  THURSDAY: 'Jueves', FRIDAY: 'Viernes', SATURDAY: 'Sábado', SUNDAY: 'Domingo',
}

const INCIDENCE_LABELS: Record<string, string> = {
  ABSENT: 'Ausente',
  INCOMPLETE_DAY_OPEN: 'Olvido de marcaje',
  INCOMPLETE_DAY_CLOSED: 'Auto-cierre',
  LATE_ARRIVAL: 'Llegada tarde',
  EARLY_DEPARTURE: 'Salida temprana',
}

type Status = MatrixDay['status']

const STATUS_STYLES: Record<Status, { bg: string; text: string; border: string; label: string }> = {
  present:   { bg: 'bg-emerald-50',  text: 'text-emerald-800', border: 'border-emerald-200', label: 'Presente' },
  encurso:   { bg: 'bg-sky-50',      text: 'text-sky-800',     border: 'border-sky-300',     label: 'En curso' },
  autoclose: { bg: 'bg-orange-50',   text: 'text-orange-800',  border: 'border-orange-200',  label: 'Auto-cierre' },
  absent:    { bg: 'bg-red-50',      text: 'text-red-700',     border: 'border-red-200',     label: 'Ausente' },
  holiday:   { bg: 'bg-blue-50',     text: 'text-blue-800',    border: 'border-blue-200',    label: 'Feriado' },
  timeoff:   { bg: 'bg-violet-50',   text: 'text-violet-800',  border: 'border-violet-200',  label: 'Licencia' },
  dayoff:    { bg: 'bg-gray-50',     text: 'text-gray-200',    border: 'border-gray-100',    label: '—' },
}

const REAL_SOURCES = new Set(['APP', 'QR', 'MANUAL', 'FACE_ID', 'GPS', 'BEACON', 'NFC', 'KIOSK', 'INTEGRATION'])

function isRealSrc(s: string | null) { return s !== null && REAL_SOURCES.has(s.split(' ')[0]) }

function fmtH(h: number | null): string {
  if (h === null || h === 0) return ''
  const totalMin = Math.round(h * 60)
  const hrs = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  return mins > 0 ? `${hrs}:${String(mins).padStart(2, '0')}` : `${hrs}h`
}

function pct(worked: number, scheduled: number): string {
  if (scheduled === 0) return '—'
  return `${Math.round((worked / scheduled) * 100)}%`
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────

interface TooltipPos { x: number; y: number; below: boolean }

function Tooltip({ day, date, empName, pos }: { day: MatrixDay; date: string; empName: string; pos: TooltipPos }) {
  const [, mo, d] = date.split('-')
  // Fixed positioning relative to viewport — escapes overflow/stacking-context constraints
  const style: React.CSSProperties = {
    position: 'fixed',
    left: pos.x,
    top: pos.below ? pos.y : undefined,
    bottom: pos.below ? undefined : window.innerHeight - pos.y,
    transform: 'translateX(-50%)',
    zIndex: 9999,
    width: '15rem',
  }
  const arrow = pos.below
    ? 'absolute left-1/2 -translate-x-1/2 bottom-full w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-gray-900'
    : 'absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900'

  return (
    <div style={style} className="bg-gray-900 text-white text-xs rounded-xl shadow-2xl p-3 pointer-events-none">
      <div className="font-semibold text-gray-200 truncate mb-0.5">{empName}</div>
      <div className="text-gray-400 mb-2">
        {WEEKDAY_FULL[day.weekday] ?? day.weekday} {`${d}/${mo}`}
        {day.status === 'encurso' && (
          <span className="ml-2 bg-sky-700 text-sky-200 px-1.5 py-0.5 rounded text-xs animate-pulse">EN CURSO</span>
        )}
      </div>

      {/* Incidences */}
      {day.incidences.length > 0 && (
        <div className="mb-2 space-y-0.5">
          {day.incidences.map((inc) => (
            <div key={inc} className="flex items-center gap-1 text-yellow-300">
              <span>⚠</span>
              <span>{INCIDENCE_LABELS[inc] ?? inc}</span>
            </div>
          ))}
        </div>
      )}

      {day.holidayName && (
        <div className="flex items-center gap-1 text-blue-300 mb-1">🔵 {day.holidayName}</div>
      )}
      {day.timeOffName && (
        <div className="flex items-center gap-1 text-violet-300 mb-1">🟣 {day.timeOffName}</div>
      )}
      {day.status === 'absent' && (
        <div className="text-red-400 mb-1">Sin registros de marcaje</div>
      )}

      {/* Schedule + entries */}
      {(day.scheduledStart || day.entry1) && (
        <div className="border-t border-gray-700 mt-1.5 pt-1.5 space-y-1">
          {day.scheduledStart && (
            <div className="text-gray-500">
              Prog: <span className="font-mono">{day.scheduledStart}–{day.scheduledEnd}</span>
            </div>
          )}

          {/* Session 1 */}
          {day.entry1 && (
            <div className={`flex items-center gap-1 ${!isRealSrc(day.entry1Source) ? 'text-orange-300' : ''}`}>
              <span className="text-gray-500">Ses.1:</span>
              <span className="font-mono">{day.entry1}</span>
              {day.entry1Source && !isRealSrc(day.entry1Source) && (
                <span className="text-orange-400 text-xs">({day.entry1Source})</span>
              )}
              <span className="text-gray-500">→</span>
              {day.exit1 ? (
                <>
                  <span className={`font-mono ${!isRealSrc(day.exit1Source) ? 'text-orange-300' : 'text-emerald-300'}`}>
                    {day.exit1}
                  </span>
                  {day.exit1Source && (
                    <span className={`text-xs ${isRealSrc(day.exit1Source) ? 'text-emerald-400' : 'text-orange-400'}`}>
                      ({day.exit1Source})
                    </span>
                  )}
                </>
              ) : (
                <span className="text-sky-400 italic">En curso</span>
              )}
            </div>
          )}

          {/* Session 2 */}
          {day.entry2 && (
            <div className={`flex items-center gap-1 ${isRealSrc(day.entry2Source) ? '' : 'text-orange-300'}`}>
              <span className="text-gray-500">Ses.2:</span>
              <span className="font-mono text-emerald-300">{day.entry2}</span>
              {day.entry2Source && (
                <span className="text-emerald-400 text-xs">({day.entry2Source})</span>
              )}
              <span className="text-gray-500">→</span>
              {day.exit2 ? (
                <>
                  <span className={`font-mono ${!isRealSrc(day.exit2Source) ? 'text-orange-300' : 'text-emerald-300'}`}>
                    {day.exit2}
                  </span>
                  {day.exit2Source && (
                    <span className={`text-xs ${isRealSrc(day.exit2Source) ? 'text-emerald-400' : 'text-orange-400'}`}>
                      ({day.exit2Source})
                    </span>
                  )}
                </>
              ) : (
                <span className="text-sky-400 italic">En curso</span>
              )}
            </div>
          )}

          {day.sites.length > 0 && (
            <div className="text-gray-400 text-xs">📍 {day.sites.join(', ')}</div>
          )}
        </div>
      )}

      {/* Hours */}
      {day.correctedHours !== null && (
        <div className="border-t border-gray-700 mt-1.5 pt-1.5 flex justify-between items-center">
          <span className="text-gray-400">{day.isEnCurso ? 'Hs. estimadas:' : 'Hs. trabajadas:'}</span>
          <span className={`font-bold ${day.isEnCurso ? 'text-sky-300' : day.isAutoClose ? 'text-orange-300' : 'text-emerald-300'}`}>
            {fmtH(day.correctedHours)}
            {day.isAutoClose && !day.isEnCurso && ' *'}
          </span>
        </div>
      )}
      {day.isAutoClose && !day.isEnCurso && (
        <div className="text-orange-400 text-xs mt-0.5">* Hora prog. por auto-cierre</div>
      )}
      {day.isEnCurso && day.scheduledEnd && (
        <div className="text-sky-400 text-xs mt-0.5">Estimado hasta {day.scheduledEnd} prog.</div>
      )}

      <div className={arrow} />
    </div>
  )
}

// ─── Day cell ─────────────────────────────────────────────────────────────────

const DEFAULT_POS: TooltipPos = { x: 0, y: 0, below: false }
const TOOLTIP_H = 230 // generous estimate of tooltip height in px

function DayCell({ day, date, empName }: { day: MatrixDay; date: string; empName: string }) {
  const [hover, setHover] = useState(false)
  const [tooltipPos, setTooltipPos] = useState<TooltipPos>(DEFAULT_POS)
  const tdRef = useRef<HTMLTableCellElement>(null)
  const s = STATUS_STYLES[day.status]

  const label = (() => {
    if (day.status === 'dayoff') return <span className="text-gray-200 text-lg leading-none">·</span>
    if (day.status === 'holiday') return <span className="text-blue-600 font-bold text-xs">FER</span>
    if (day.status === 'timeoff') return <span className="text-violet-600 font-bold text-xs">LIC</span>
    if (day.status === 'absent') return <span className="text-red-500 font-bold text-xs">AUS</span>
    if (day.correctedHours !== null) {
      return (
        <>
          <span className="font-bold leading-tight text-xs">{fmtH(day.correctedHours)}</span>
          {day.status === 'encurso' && (
            <span className="text-sky-600 text-xs leading-none">▶</span>
          )}
          {day.status === 'autoclose' && (
            <span className="text-orange-500 text-xs leading-none">⚠</span>
          )}
        </>
      )
    }
    return null
  })()

  // Highlight if has incidences
  const hasIncidence = day.incidences.length > 0 && day.status !== 'absent'

  return (
    <td
      ref={tdRef}
      className="relative p-0 border-r border-gray-100"
      onMouseEnter={() => {
        if (tdRef.current) {
          const r = tdRef.current.getBoundingClientRect()
          const centerX = r.left + r.width / 2
          // Show below when there's not enough space above for the tooltip
          const below = r.top < TOOLTIP_H + 8
          setTooltipPos({
            x: centerX,
            y: below ? r.bottom + 6 : r.top - 6,
            below,
          })
        }
        setHover(true)
      }}
      onMouseLeave={() => setHover(false)}
    >
      <div
        className={`w-14 h-10 flex flex-col items-center justify-center border cursor-default transition-all ${s.bg} ${s.border} ${hover ? 'brightness-95 scale-95' : ''}`}
      >
        {label}
        {hasIncidence && (
          <div className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-yellow-400" title="Incidencia" />
        )}
      </div>
      {hover && <Tooltip day={day} date={date} empName={empName} pos={tooltipPos} />}
    </td>
  )
}

// ─── Branch section ───────────────────────────────────────────────────────────

function BranchSection({ branch, employees, dates }: {
  branch: string
  employees: MatrixEmployee[]
  dates: string[]
}) {
  const [collapsed, setCollapsed] = useState(false)

  const bTotals = useMemo(() => ({
    correctedHours: employees.reduce((s, e) => s + e.totals.correctedHours, 0),
    scheduledHours: employees.reduce((s, e) => s + e.totals.scheduledHours, 0),
    daysPresent: employees.reduce((s, e) => s + e.totals.daysPresent, 0),
    daysAbsent: employees.reduce((s, e) => s + e.totals.daysAbsent, 0),
    autoClose: employees.reduce((s, e) => s + e.totals.autoCloseDays, 0),
    enCurso: employees.reduce((s, e) => s + e.totals.enCursoDays, 0),
  }), [employees])

  const perDate = useMemo(() => {
    const m: Record<string, number> = {}
    for (const d of dates) {
      m[d] = employees.reduce((s, e) => s + (e.days[d]?.correctedHours ?? 0), 0)
    }
    return m
  }, [employees, dates])

  return (
    <tbody>
      <tr className="bg-gray-800 text-white border-t-2 border-gray-700">
        <td colSpan={5} className="px-3 py-1.5 sticky left-0 bg-gray-800 z-10">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest hover:text-gray-200"
          >
            <span>{collapsed ? '▸' : '▾'}</span>
            📍 {branch}
            <span className="font-normal text-gray-400 ml-1">({employees.length} colaboradores)</span>
            {bTotals.enCurso > 0 && (
              <span className="bg-sky-600 text-white text-xs px-1.5 py-0.5 rounded-full">
                {bTotals.enCurso} en curso
              </span>
            )}
          </button>
        </td>
        {dates.map((d) => (
          <td key={d} className="w-14 text-center text-xs text-gray-400 py-1">
            {fmtH(perDate[d]) || ''}
          </td>
        ))}
        <td className="px-1 text-center text-xs font-semibold text-emerald-300">{fmtH(bTotals.correctedHours)}</td>
        <td className="px-1 text-center text-xs text-gray-400">{fmtH(bTotals.scheduledHours)}</td>
        <td className="px-1 text-center text-xs">{pct(bTotals.correctedHours, bTotals.scheduledHours)}</td>
        <td className="px-1 text-center text-xs text-emerald-300">{bTotals.daysPresent}</td>
        <td className="px-1 text-center text-xs text-red-300">{bTotals.daysAbsent}</td>
      </tr>

      {!collapsed && employees.map((emp) => (
        <tr key={emp.employeeId} className="hover:bg-gray-50 border-b border-gray-100">
          <td className="sticky left-0 bg-white z-10 border-r border-gray-200 px-3 py-1 min-w-44">
            <div className="text-xs font-semibold text-gray-800 truncate max-w-40">
              {emp.name}
              {emp.totals.enCursoDays > 0 && (
                <span className="ml-1.5 text-sky-600 text-xs">▶</span>
              )}
            </div>
            <div className="text-xs text-gray-400">{emp.puesto}</div>
          </td>
          {/* Auto-close count */}
          <td className="text-xs text-center border-r border-gray-100 px-1 w-10">
            {emp.totals.autoCloseDays > 0 && (
              <span className="text-orange-500 font-medium">{emp.totals.autoCloseDays}</span>
            )}
          </td>
          {/* Worked hours */}
          <td className="text-xs text-center font-semibold text-gray-800 border-r border-gray-100 px-1 w-14">
            {fmtH(emp.totals.correctedHours)}
          </td>
          {/* Scheduled hours */}
          <td className="text-xs text-center text-gray-500 border-r border-gray-100 px-1 w-14">
            {fmtH(emp.totals.scheduledHours) || '—'}
          </td>
          {/* % */}
          <td className="text-xs text-center border-r border-gray-100 px-1 w-10">
            {emp.totals.scheduledHours > 0 ? (
              <span className={
                (emp.totals.correctedHours / emp.totals.scheduledHours) >= 0.95
                  ? 'text-emerald-600 font-medium'
                  : (emp.totals.correctedHours / emp.totals.scheduledHours) >= 0.80
                  ? 'text-yellow-600'
                  : 'text-red-500 font-medium'
              }>
                {pct(emp.totals.correctedHours, emp.totals.scheduledHours)}
              </span>
            ) : <span className="text-gray-300">—</span>}
          </td>

          {/* Day cells */}
          {dates.map((date) => {
            const day = emp.days[date]
            if (!day) return <td key={date} className="w-14 border-r border-gray-100" />
            return <DayCell key={date} day={day} date={date} empName={emp.name} />
          })}

          {/* Right totals */}
          <td className="text-xs text-center font-bold text-gray-900 px-1 w-14 border-l-2 border-gray-200">
            {fmtH(emp.totals.correctedHours)}
          </td>
          <td className="text-xs text-center text-gray-400 px-1 w-14">
            {fmtH(emp.totals.scheduledHours) || '—'}
          </td>
          <td className="text-xs text-center px-1 w-10">
            {emp.totals.scheduledHours > 0 ? (
              <span className={
                (emp.totals.correctedHours / emp.totals.scheduledHours) >= 0.95
                  ? 'text-emerald-600 font-medium'
                  : (emp.totals.correctedHours / emp.totals.scheduledHours) >= 0.80
                  ? 'text-yellow-600'
                  : 'text-red-500 font-medium'
              }>
                {pct(emp.totals.correctedHours, emp.totals.scheduledHours)}
              </span>
            ) : <span className="text-gray-300">—</span>}
          </td>
          <td className="text-xs text-center text-emerald-600 font-medium px-1 w-8">
            {emp.totals.daysPresent > 0 ? emp.totals.daysPresent : ''}
          </td>
          <td className="text-xs text-center text-red-500 font-medium px-1 w-8">
            {emp.totals.daysAbsent > 0 ? emp.totals.daysAbsent : ''}
          </td>
        </tr>
      ))}
    </tbody>
  )
}

// ─── Excel export ─────────────────────────────────────────────────────────────

function round2(h: number): number {
  return Math.round(h * 100) / 100
}

function exportMatrixToExcel(matrixData: MatrixData, dates: string[]) {
  const WEEKDAY_SHORT: Record<string, string> = {
    MONDAY: 'Lun', TUESDAY: 'Mar', WEDNESDAY: 'Mié',
    THURSDAY: 'Jue', FRIDAY: 'Vie', SATURDAY: 'Sáb', SUNDAY: 'Dom',
  }

  // Header row: fixed columns + 4 columns per date (Normal / Ext.50% / Ext.100% / Noct.)
  // + 4 period-total columns per type + the pre-existing overall totals.
  const header = [
    'Colaborador', 'Sucursal', 'Puesto',
    'Hs. Trab.', 'Hs. Prog.', '%', 'Presentes', 'Ausentes', 'Auto-cierres',
    ...dates.flatMap((d) => {
      const [, mo, day] = d.split('-')
      const emp0 = matrixData.employees[0]
      const wd = emp0?.days[d]?.weekday ?? ''
      const label = `${day}/${mo} ${WEEKDAY_SHORT[wd] ?? ''}`
      return [`${label} Normal`, `${label} Ext.50%`, `${label} Ext.100%`, `${label} Noct.`]
    }),
    'Total Normal', 'Total Ext.50%', 'Total Ext.100%', 'Total Noct.',
    'Total Hs.', 'Prog. Hs.', '% Total',
  ]

  const rows: (string | number)[][] = [header]

  let prevBranch = ''
  for (const emp of matrixData.employees) {
    // Insert branch separator row
    if (emp.location !== prevBranch) {
      rows.push([`--- ${emp.location} ---`])
      prevBranch = emp.location
    }

    const worked = emp.totals.correctedHours
    const scheduled = emp.totals.scheduledHours
    const pctVal = scheduled > 0 ? Math.round((worked / scheduled) * 100) : 0

    // 4 numeric columns per day (decimal hours) for the payroll system to consume.
    const dayCols = dates.flatMap((d) => {
      const day = emp.days[d]
      if (!day) return [0, 0, 0, 0]
      return [
        round2(day.normalHours),
        round2(day.extra50Hours),
        round2(day.extra100Hours),
        round2(day.nightHours),
      ]
    })

    rows.push([
      emp.name,
      emp.location,
      emp.puesto,
      fmtH(worked),
      fmtH(scheduled) || '—',
      `${pctVal}%`,
      emp.totals.daysPresent,
      emp.totals.daysAbsent,
      emp.totals.autoCloseDays,
      ...dayCols,
      round2(emp.totals.normalHours),
      round2(emp.totals.extra50Hours),
      round2(emp.totals.extra100Hours),
      round2(emp.totals.nightHours),
      fmtH(worked),
      fmtH(scheduled) || '—',
      `${pctVal}%`,
    ])
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)

  // Auto-width for first 3 columns
  ws['!cols'] = [
    { wch: 28 }, { wch: 16 }, { wch: 16 },
    { wch: 9 }, { wch: 9 }, { wch: 6 }, { wch: 9 }, { wch: 9 }, { wch: 12 },
    ...dates.flatMap(() => [{ wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }]),
    { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 },
    { wch: 9 }, { wch: 9 }, { wch: 7 },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Asistencia')

  const [startY, startM, startD] = (matrixData.dates[0] ?? '').split('-')
  const [, endM, endD] = (matrixData.dates[matrixData.dates.length - 1] ?? '').split('-')
  const fileName = `asistencia_${startD}-${startM}_al_${endD}-${endM}-${startY}.xlsx`
  XLSX.writeFile(wb, fileName)
}

// ─── Filters ──────────────────────────────────────────────────────────────────

interface FilterState {
  startDate: string
  endDate: string
  location: string
  search: string
}

const QUICK_RANGES = [
  { label: 'Este mes', s: () => getFirstDayOfMonth(), e: () => getTodayString() },
  { label: 'Últ. 7 días', s: () => subtractDays(6), e: () => getTodayString() },
  { label: 'Últ. 14 días', s: () => subtractDays(13), e: () => getTodayString() },
  { label: 'Últ. 30 días', s: () => subtractDays(29), e: () => getTodayString() },
]

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  matrixData: MatrixData | null
  loading: boolean
  error: string | null
  filters: FilterState
  onFiltersChange: (f: FilterState) => void
  onFetch: (f: FilterState) => void
}

export default function MatrixView({ matrixData, loading, error, filters, onFiltersChange, onFetch }: Props) {
  const [local, setLocal] = useState(filters)

  const locations = useMemo(() => {
    if (!matrixData) return []
    return [...new Set(matrixData.employees.map((e) => e.location))].sort()
  }, [matrixData])

  const filtered = useMemo(() => {
    if (!matrixData) return []
    return matrixData.employees.filter((e) => {
      if (local.location && local.location !== 'all' && e.location !== local.location) return false
      if (local.search && !e.name.toLowerCase().includes(local.search.toLowerCase())) return false
      return true
    })
  }, [matrixData, local.location, local.search])

  const byBranch = useMemo(() => {
    const m: Record<string, MatrixEmployee[]> = {}
    for (const e of filtered) {
      if (!m[e.location]) m[e.location] = []
      m[e.location].push(e)
    }
    return m
  }, [filtered])

  const grand = useMemo(() => ({
    correctedHours: filtered.reduce((s, e) => s + e.totals.correctedHours, 0),
    scheduledHours: filtered.reduce((s, e) => s + e.totals.scheduledHours, 0),
    daysPresent: filtered.reduce((s, e) => s + e.totals.daysPresent, 0),
    daysAbsent: filtered.reduce((s, e) => s + e.totals.daysAbsent, 0),
    autoClose: filtered.reduce((s, e) => s + e.totals.autoCloseDays, 0),
    enCurso: filtered.reduce((s, e) => s + e.totals.enCursoDays, 0),
  }), [filtered])

  function apply(f: FilterState) {
    setLocal(f)
    onFiltersChange(f)
    onFetch(f)
  }

  const dates = matrixData?.dates ?? []

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-gray-500 font-medium">Rango rápido:</span>
          {QUICK_RANGES.map((q) => (
            <button key={q.label} onClick={() => apply({ ...local, startDate: q.s(), endDate: q.e() })}
              className="text-xs px-3 py-1 rounded-full border border-gray-200 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 transition-colors">
              {q.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Fecha inicio</label>
            <input type="date" value={local.startDate}
              onChange={(e) => setLocal({ ...local, startDate: e.target.value })}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Fecha fin</label>
            <input type="date" value={local.endDate}
              onChange={(e) => setLocal({ ...local, endDate: e.target.value })}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Sucursal</label>
            <select value={local.location} onChange={(e) => setLocal({ ...local, location: e.target.value })}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400">
              <option value="all">Todas las sucursales</option>
              {locations.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Buscar colaborador</label>
            <input type="text" value={local.search} onChange={(e) => setLocal({ ...local, search: e.target.value })}
              placeholder="Nombre..."
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          </div>
          <button onClick={() => apply(local)} disabled={loading}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white text-sm font-semibold rounded-lg flex items-center gap-2 transition-colors">
            {loading
              ? <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Cargando...</>
              : <><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>Buscar</>}
          </button>
        </div>
      </div>

      {/* Legend + KPIs + Export */}
      {matrixData && (
        <div className="flex flex-wrap gap-4 items-center justify-between">
          <div className="flex flex-wrap gap-3 text-xs">
            {[
              { color: 'bg-emerald-50 border-emerald-200', label: 'Presente' },
              { color: 'bg-sky-50 border-sky-300', label: 'En curso ▶' },
              { color: 'bg-orange-50 border-orange-200', label: 'Auto-cierre ⚠' },
              { color: 'bg-red-50 border-red-200', label: 'Ausente' },
              { color: 'bg-blue-50 border-blue-200', label: 'Feriado' },
              { color: 'bg-violet-50 border-violet-200', label: 'Licencia' },
            ].map(({ color, label }) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className={`w-4 h-4 rounded border ${color} inline-block`} />
                <span className="text-gray-600">{label}</span>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-gray-600 font-semibold">{filtered.length} colaboradores</span>
            {grand.enCurso > 0 && (
              <span className="text-sky-600 font-bold">{grand.enCurso} en curso ahora</span>
            )}
            <span className="text-emerald-700 font-bold">{fmtH(grand.correctedHours)} trabajadas</span>
            {grand.autoClose > 0 && <span className="text-orange-600">{grand.autoClose} auto-cierres</span>}
            {grand.daysAbsent > 0 && <span className="text-red-500">{grand.daysAbsent} ausencias</span>}
            <button
              onClick={() => exportMatrixToExcel(matrixData, dates)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg transition-colors font-medium"
              title="Exportar a Excel"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Exportar Excel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          Error: {error}
        </div>
      )}

      {loading && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <svg className="animate-spin h-8 w-8 text-emerald-500 mx-auto mb-3" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm text-gray-500">Consultando API Humand...</p>
          <p className="text-xs text-gray-400 mt-1">Procesando datos por grupos para evitar límites de la API</p>
        </div>
      )}

      {/* Matrix */}
      {!loading && matrixData && dates.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse" style={{ minWidth: `${Math.max(700, dates.length * 56 + 400)}px` }}>
              <thead>
                <tr className="bg-gray-100 border-b-2 border-gray-200">
                  <th className="sticky left-0 bg-gray-100 z-20 px-3 py-2 text-left font-bold text-gray-700 min-w-44 border-r border-gray-200">
                    Colaborador
                  </th>
                  <th className="w-10 text-center text-orange-500 border-r border-gray-200 px-1" title="Auto-cierres">⚠</th>
                  <th className="w-14 text-center font-bold text-gray-700 border-r border-gray-200 px-1">Hs.Trab.</th>
                  <th className="w-14 text-center text-gray-500 border-r border-gray-200 px-1">Hs.Prog.</th>
                  <th className="w-10 text-center text-gray-500 border-r border-gray-200 px-1">%</th>
                  {dates.map((d) => {
                    const [, mo, day] = d.split('-')
                    const wd = (matrixData.employees[0]?.days[d]?.weekday) ?? ''
                    const isWeekend = wd === 'SATURDAY' || wd === 'SUNDAY'
                    return (
                      <th key={d} className={`w-14 text-center border-r border-gray-200 py-1.5 px-0 ${isWeekend ? 'bg-gray-200 text-gray-500' : 'text-gray-700'}`}>
                        <div className="font-bold">{day}</div>
                        <div className="text-gray-400">{WEEKDAY_ES[wd] ?? mo}</div>
                      </th>
                    )
                  })}
                  <th className="w-14 text-center font-bold text-gray-700 border-l-2 border-gray-300 px-1">Total</th>
                  <th className="w-14 text-center text-gray-500 px-1">Prog.</th>
                  <th className="w-10 text-center text-gray-500 px-1">%</th>
                  <th className="w-8 text-center text-emerald-600 px-1" title="Días presentes">✓</th>
                  <th className="w-8 text-center text-red-500 px-1" title="Días ausentes">✗</th>
                </tr>
              </thead>

              {Object.entries(byBranch).map(([branch, emps]) => (
                <BranchSection key={branch} branch={branch} employees={emps} dates={dates} />
              ))}

              <tfoot>
                <tr className="bg-gray-900 text-white font-bold border-t-2 border-gray-700">
                  <td className="sticky left-0 bg-gray-900 z-10 px-3 py-2 text-xs uppercase tracking-wide border-r border-gray-700">
                    TOTAL GENERAL
                  </td>
                  <td className="text-center text-xs text-orange-300 px-1">{grand.autoClose || ''}</td>
                  <td className="text-center text-xs text-emerald-300 px-1">{fmtH(grand.correctedHours)}</td>
                  <td className="text-center text-xs text-gray-400 px-1">{fmtH(grand.scheduledHours)}</td>
                  <td className="text-center text-xs px-1">{pct(grand.correctedHours, grand.scheduledHours)}</td>
                  {dates.map((d) => {
                    const tot = filtered.reduce((s, e) => s + (e.days[d]?.correctedHours ?? 0), 0)
                    return (
                      <td key={d} className="w-14 text-center text-xs text-gray-300 border-r border-gray-700 py-2">
                        {tot > 0 ? fmtH(tot) : ''}
                      </td>
                    )
                  })}
                  <td className="text-center text-xs text-emerald-300 px-1 border-l-2 border-gray-700">
                    {fmtH(grand.correctedHours)}
                  </td>
                  <td className="text-center text-xs text-gray-400 px-1">{fmtH(grand.scheduledHours)}</td>
                  <td className="text-center text-xs px-1">{pct(grand.correctedHours, grand.scheduledHours)}</td>
                  <td className="text-center text-xs text-green-300 px-1">{grand.daysPresent || ''}</td>
                  <td className="text-center text-xs text-red-300 px-1">{grand.daysAbsent || ''}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 text-xs text-gray-400 flex flex-wrap gap-4 items-center">
            <span>ℹ️ Salidas AUTO_CLOSE/DAY_CHANGE usan hora prog. de salida</span>
            <span>▶ = sesión en curso (estimado hasta hora prog.)</span>
            <span>🟡 = incidencia registrada (hover para detalle)</span>
            <span>Datos en tiempo real · API Humand</span>
          </div>
        </div>
      )}

      {!loading && !matrixData && !error && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          <p className="text-sm">Seleccioná un rango de fechas y presioná Buscar</p>
        </div>
      )}
    </div>
  )
}
