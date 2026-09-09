import { NextRequest, NextResponse } from 'next/server'
import {
  fetchAllEmployees,
  fetchAllDaySummaries,
  computeCorrectedHours,
  HumandDaySummary,
  HumandEmployee,
} from '@/lib/humand'
import { AttendanceRow } from '@/lib/types'

const WEEKDAY_ES: Record<string, string> = {
  MONDAY: 'Lunes',
  TUESDAY: 'Martes',
  WEDNESDAY: 'Miércoles',
  THURSDAY: 'Jueves',
  FRIDAY: 'Viernes',
  SATURDAY: 'Sábado',
  SUNDAY: 'Domingo',
}

function toBATime(isoStr: string): string {
  const ba = new Date(new Date(isoStr).getTime() - 3 * 3_600_000)
  return `${String(ba.getUTCHours()).padStart(2, '0')}:${String(ba.getUTCMinutes()).padStart(2, '0')}`
}

function minuteDiff(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000
}

function fmtMinutes(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  return `${h}:${String(m).padStart(2, '0')}`
}

function buildRow(
  summary: HumandDaySummary,
  emp: HumandEmployee | undefined
): AttendanceRow {
  const slots = (summary.timeSlots ?? []).sort((a, b) => a.id - b.id)
  const scheduledStart = slots.length > 0 ? slots[0].startTime : null
  const scheduledEnd = slots.length > 0 ? slots[slots.length - 1].endTime : null

  const sorted = [...summary.entries].sort(
    (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
  )
  const sortedStarts = sorted.filter((e) => e.type === 'START')
  const sortedEnds = sorted.filter((e) => e.type === 'END')

  const { session1IsCarryover } = computeCorrectedHours(
    summary.entries,
    summary.timeSlots,
    summary.referenceDate
  )

  // Filter out carryover artifact so only real sessions are shown
  const dispStarts = session1IsCarryover ? sortedStarts.slice(1) : sortedStarts
  const dispEnds = session1IsCarryover ? sortedEnds.slice(1) : sortedEnds

  const { correctedHours, isAutoClose } = computeCorrectedHours(
    summary.entries,
    summary.timeSlots,
    summary.referenceDate
  )

  // Almuerzo = gap between session 1 exit and session 2 entry (only for genuine 2-session days)
  let almuerzo: string | null = null
  if (dispStarts.length >= 2 && dispEnds.length >= 1) {
    const gap = minuteDiff(dispEnds[0].time, dispStarts[1].time)
    if (gap > 0) almuerzo = fmtMinutes(gap)
  }

  const name = emp ? `${emp.firstName} ${emp.lastName}` : summary.employeeId

  return {
    Fecha: summary.referenceDate,
    Día: WEEKDAY_ES[summary.weekday] ?? summary.weekday,
    Colaborador: name,
    'Hr. Prog. Ent.': scheduledStart,
    'Hr. Prog. Sal.': scheduledEnd,
    'Ent. 1': dispStarts[0] ? toBATime(dispStarts[0].time) : null,
    'Sal. 1': dispEnds[0] ? toBATime(dispEnds[0].time) : null,
    'Ent. 2': dispStarts[1] ? toBATime(dispStarts[1].time) : null,
    'Sal. 2': dispEnds[1] ? toBATime(dispEnds[1].time) : null,
    Almuerzo: almuerzo,
    'Hrs. Trab.': correctedHours !== null ? correctedHours.toFixed(6) : null,
    'Mét. Ent. 1': dispStarts[0]?.source ?? null,
    'Mét. Sal. 1': dispEnds[0]?.source ?? null,
    'Mét. Ent. 2': dispStarts[1]?.source ?? null,
    'Mét. Sal. 2': dispEnds[1]?.source ?? null,
    Feriado: summary.holidays[0]?.name ?? null,
    Licencia: summary.timeOffRequests[0]?.name ?? null,
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const startDate = searchParams.get('fecha_inicio') ?? searchParams.get('startDate') ?? ''
  const endDate = searchParams.get('fecha_fin') ?? searchParams.get('endDate') ?? ''
  const colaborador = searchParams.get('colaborador') ?? '%'

  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'fecha_inicio y fecha_fin son requeridos' }, { status: 400 })
  }

  try {
    const employees = await fetchAllEmployees()
    const employeeIds = employees.map((e) => e.employeeInternalId)
    const summaries = await fetchAllDaySummaries(employeeIds, startDate, endDate)

    const empMap: Record<string, HumandEmployee> = {}
    for (const e of employees) empMap[e.employeeInternalId] = e

    // Include days with entries, holidays, licencias, OR scheduled workdays without entries (absences)
    const relevant = summaries.filter(
      (s) =>
        s.entries.length > 0 ||
        s.holidays.length > 0 ||
        s.timeOffRequests.length > 0 ||
        (s.hasSchedule && s.isWorkday)
    )

    let rows: AttendanceRow[] = relevant
      .map((s) => buildRow(s, empMap[s.employeeId]))
      .sort((a, b) => {
        const dateComp = b.Fecha.localeCompare(a.Fecha)
        return dateComp !== 0 ? dateComp : a.Colaborador.localeCompare(b.Colaborador)
      })

    // Filter by collaborator name if specified
    if (colaborador && colaborador !== '%') {
      const q = colaborador.replace(/%/g, '').toLowerCase()
      rows = rows.filter((r) => r.Colaborador.toLowerCase().includes(q))
    }

    return NextResponse.json({ rows })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
