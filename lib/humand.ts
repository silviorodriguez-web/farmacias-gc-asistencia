const BASE = 'https://api-prod.humand.co/public/api/v1'
const AUTH = `Basic ${process.env.HUMAND_API_KEY}`

const REAL_SOURCES = new Set(['APP', 'QR', 'MANUAL', 'FACE_ID', 'GPS', 'BEACON', 'NFC', 'KIOSK', 'INTEGRATION'])

export interface HumandEmployee {
  id: number
  employeeInternalId: string
  firstName: string
  lastName: string
  email: string
  status: string
  segmentations: { group: string; item: string }[]
}

export interface HumandEntry {
  id: number
  userId: number
  employeeId: string
  type: 'START' | 'END'
  source: string
  time: string
  referenceDate: string
  site?: { id: number; name: string; location?: { address: string } } | null
}

export interface HumandTimeSlot {
  id: number
  startTime: string
  endTime: string
  assignedShiftId?: number
}

export interface HumandDaySummary {
  id: number
  referenceDate: string
  employeeId: string
  userId: number
  weekday: string
  isWorkday: boolean
  hasSchedule: boolean
  hours: { worked: number; scheduled: number; estimated: number; timeOff: number }
  entries: HumandEntry[]
  timeSlots: HumandTimeSlot[] | null
  holidays: { id: number; name: string }[]
  timeOffRequests: { id: number; name: string }[]
  incidences: string[]
}

export type DayStatus = 'present' | 'encurso' | 'autoclose' | 'absent' | 'holiday' | 'timeoff' | 'dayoff'

export interface MatrixDay {
  status: DayStatus
  correctedHours: number | null
  rawHours: number
  normalHours: number
  extra50Hours: number
  extra100Hours: number
  nightHours: number
  isAutoClose: boolean
  isEnCurso: boolean
  holidayName: string | null
  timeOffName: string | null
  weekday: string
  isWorkday: boolean
  hasSchedule: boolean
  scheduledStart: string | null
  scheduledEnd: string | null
  entry1: string | null
  exit1: string | null
  entry2: string | null
  exit2: string | null
  exit1Source: string | null
  exit2Source: string | null
  entry1Source: string | null
  entry2Source: string | null
  sites: string[]
  incidences: string[]
}

export interface MatrixEmployee {
  employeeId: string
  name: string
  location: string
  area: string
  puesto: string
  days: Record<string, MatrixDay>
  totals: {
    correctedHours: number
    scheduledHours: number
    normalHours: number
    extra50Hours: number
    extra100Hours: number
    nightHours: number
    daysPresent: number
    daysAbsent: number
    autoCloseDays: number
    holidayDays: number
    timeOffDays: number
    enCursoDays: number
  }
}

export interface MatrixData {
  employees: MatrixEmployee[]
  dates: string[]
}

async function humandFetch(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: AUTH },
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Humand API ${res.status}: ${body.slice(0, 300)}`)
  }
  return res.json()
}

export async function fetchAllEmployees(): Promise<HumandEmployee[]> {
  const pages = await Promise.all([
    humandFetch('/users?page=1&limit=50'),
    humandFetch('/users?page=2&limit=50'),
  ])
  return pages.flatMap((p) => (p.users ?? []) as HumandEmployee[])
}

export async function fetchAllDaySummaries(
  employeeIds: string[],
  startDate: string,
  endDate: string
): Promise<HumandDaySummary[]> {
  // The API silently caps responses at 500 items and returns totalPages=1 even when
  // there are more records. We must batch by employee group to stay under 500/batch.
  const days =
    Math.ceil((new Date(endDate + 'T12:00:00Z').getTime() - new Date(startDate + 'T12:00:00Z').getTime()) / 86_400_000) + 1
  const batchSize = Math.max(1, Math.floor(480 / days))

  const batches: string[][] = []
  for (let i = 0; i < employeeIds.length; i += batchSize) {
    batches.push(employeeIds.slice(i, i + batchSize))
  }

  const results = await Promise.all(
    batches.map(async (batch) => {
      const ids = batch.map(encodeURIComponent).join(',')
      const data = await humandFetch(
        `/time-tracking/day-summaries?page=1&limit=500&employeeIds=${ids}&startDate=${startDate}&endDate=${endDate}`
      )
      return (data.items ?? []) as HumandDaySummary[]
    })
  )

  return results.flat()
}

// ─────────────────────────────────────────────────────────────────────────────
// Timezone helpers (Argentina = UTC-3, no DST)
// ─────────────────────────────────────────────────────────────────────────────

function toBADateTime(date: string, timeStr: string): number {
  const [y, mo, d] = date.split('-').map(Number)
  const [h, m] = timeStr.split(':').map(Number)
  return Date.UTC(y, mo - 1, d, h + 3, m, 0)
}

function toBATime(isoStr: string): string {
  const ba = new Date(new Date(isoStr).getTime() - 3 * 3_600_000)
  return `${String(ba.getUTCHours()).padStart(2, '0')}:${String(ba.getUTCMinutes()).padStart(2, '0')}`
}

function addDaysToDateStr(date: string, n: number): string {
  const [y, mo, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, mo - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().split('T')[0]
}

const WEEKDAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']

function weekdayOf(date: string): string {
  const [y, mo, d] = date.split('-').map(Number)
  return WEEKDAY_NAMES[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]
}

// ─────────────────────────────────────────────────────────────────────────────
// Hours calculation — mirrors Redash SQL logic + improvements for edge cases
// ─────────────────────────────────────────────────────────────────────────────

export function computeCorrectedHours(
  entries: HumandEntry[],
  timeSlots: HumandTimeSlot[] | null,
  referenceDate: string
): {
  correctedHours: number | null
  isAutoClose: boolean
  isEnCurso: boolean
  session1IsCarryover: boolean
  intervalStartMs: number | null
  intervalEndMs: number | null
} {
  const NO = {
    correctedHours: null, isAutoClose: false, isEnCurso: false, session1IsCarryover: false,
    intervalStartMs: null, intervalEndMs: null,
  }
  if (entries.length === 0) return NO

  const sorted = [...entries].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
  const starts = sorted.filter((e) => e.type === 'START')
  const ends = sorted.filter((e) => e.type === 'END')

  if (starts.length === 0) return NO

  const entrada1 = starts[0]
  const salida1 = ends[0] ?? null
  const entrada2 = starts.length > 1 ? starts[1] : null
  const salida2 = ends.length > 1 ? ends[1] : null

  // Scheduled end time = first slot by ID (mirrors Redash DISTINCT ON ORDER BY ts.id)
  const slots = (timeSlots ?? []).sort((a, b) => a.id - b.id)
  const progEndTime = slots.length > 0 ? slots[0].endTime : null

  const isReal = (src: string | null) => src !== null && REAL_SOURCES.has(src.split(' ')[0])

  // ── DAY_CHANGE carryover detection ────────────────────────────────────────
  // When session 1 is a system-generated DAY_CHANGE marker (carryover from the
  // previous day's overnight shift) AND a real session 2 exists, session 1 is
  // an artifact — ignore it entirely and treat session 2 as the only real session.
  const session1IsCarryover =
    entrada1.source === 'DAY_CHANGE' &&
    entrada2 !== null &&
    isReal(entrada2.source)

  if (session1IsCarryover) {
    const realStartMs = new Date(entrada2!.time).getTime()
    if (salida2 !== null) {
      const endMs = new Date(salida2.time).getTime()
      return {
        correctedHours: Math.max(0, (endMs - realStartMs) / 3_600_000),
        isAutoClose: !isReal(salida2.source),
        isEnCurso: false,
        session1IsCarryover: true,
        intervalStartMs: realStartMs, intervalEndMs: endMs,
      }
    }
    // Session 2 is open → en curso, estimate to scheduled end
    if (progEndTime) {
      const endMs = toBADateTime(referenceDate, progEndTime)
      return {
        correctedHours: Math.max(0, (endMs - realStartMs) / 3_600_000),
        isAutoClose: true,
        isEnCurso: true,
        session1IsCarryover: true,
        intervalStartMs: realStartMs, intervalEndMs: endMs,
      }
    }
    return {
      correctedHours: null, isAutoClose: false, isEnCurso: true, session1IsCarryover: true,
      intervalStartMs: null, intervalEndMs: null,
    }
  }

  const entry1Ms = new Date(entrada1.time).getTime()

  // ── CASE: Session 2 open (En Curso) ──────────────────────────────────────
  // New case beyond Redash SQL: session 2 started but no exit yet.
  // Common when employee is currently working (real APP session started).
  if (salida2 === null && entrada2 !== null) {
    if (progEndTime) {
      // If session 1 was a non-real source (but not DAY_CHANGE handled above),
      // start the calculation from session 2 to avoid including the overnight gap.
      const calcFromMs = !isReal(entrada1.source)
        ? new Date(entrada2.time).getTime()
        : entry1Ms
      const endMs = toBADateTime(referenceDate, progEndTime)
      return {
        correctedHours: Math.max(0, (endMs - calcFromMs) / 3_600_000),
        isAutoClose: true,
        isEnCurso: isReal(entrada2.source),
        session1IsCarryover: false,
        intervalStartMs: calcFromMs, intervalEndMs: endMs,
      }
    }
    // No prog time — fall through to session 1 calculation
  }

  // ── Redash SQL cases ──────────────────────────────────────────────────────
  if (salida2 !== null) {
    if (isReal(salida2.source) || !progEndTime) {
      const endMs = new Date(salida2.time).getTime()
      return {
        correctedHours: Math.max(0, (endMs - entry1Ms) / 3_600_000),
        isAutoClose: !isReal(salida2.source),
        isEnCurso: false,
        session1IsCarryover: false,
        intervalStartMs: entry1Ms, intervalEndMs: endMs,
      }
    }
    const endMs = toBADateTime(referenceDate, progEndTime)
    return {
      correctedHours: Math.max(0, (endMs - entry1Ms) / 3_600_000),
      isAutoClose: true,
      isEnCurso: false,
      session1IsCarryover: false,
      intervalStartMs: entry1Ms, intervalEndMs: endMs,
    }
  }

  if (salida1 !== null) {
    const endMs = new Date(salida1.time).getTime()
    return {
      correctedHours: Math.max(0, (endMs - entry1Ms) / 3_600_000),
      isAutoClose: !isReal(salida1.source),
      isEnCurso: false,
      session1IsCarryover: false,
      intervalStartMs: entry1Ms, intervalEndMs: endMs,
    }
  }

  if (progEndTime) {
    const endMs = toBADateTime(referenceDate, progEndTime)
    return {
      correctedHours: Math.max(0, (endMs - entry1Ms) / 3_600_000),
      isAutoClose: true,
      isEnCurso: false,
      session1IsCarryover: false,
      intervalStartMs: entry1Ms, intervalEndMs: endMs,
    }
  }

  return NO
}

// ─────────────────────────────────────────────────────────────────────────────
// Hour type breakdown — normal / extra 50% / extra 100% / nocturnas
//
// Rules (confirmed with client, 2026-09-11 correction from Paula Ferro):
//  - Normal: hours worked within the day's scheduled window (start–end of the
//    day's time slots). If the day has no schedule at all, everything worked
//    is "normal" (no extras are inferred) — flag for manual payroll review.
//  - Extra 50%: hours worked on a weekday (Mon–Fri) outside the scheduled
//    window, up to 21:00 (hours from 21:00 on are pulled into "nocturnas").
//  - Extra 100%: hours worked on a Saturday beyond the first 5 hours worked
//    that day (cumulative, regardless of schedule/time of day), OR any hour
//    worked on a Sunday or holiday (the whole day, regardless of schedule).
//  - Nocturnas: hours worked between 21:00 and 06:00 are pulled out of the
//    normal/extra buckets entirely and counted only as night hours.
// ─────────────────────────────────────────────────────────────────────────────

export interface HourBreakdown {
  normalHours: number
  extra50Hours: number
  extra100Hours: number
  nightHours: number
}

const NIGHT_START = '21:00'
const NIGHT_END = '06:00'
const SATURDAY_100_AFTER_MS = 5 * 3_600_000

export function computeHourBreakdown(
  intervalStartMs: number | null,
  intervalEndMs: number | null,
  scheduledStart: string | null,
  scheduledEnd: string | null,
  hasSchedule: boolean,
  referenceDate: string,
  isHoliday: boolean
): HourBreakdown {
  const zero = { normalHours: 0, extra50Hours: 0, extra100Hours: 0, nightHours: 0 }
  if (intervalStartMs === null || intervalEndMs === null || intervalEndMs <= intervalStartMs) return zero

  // Night windows (21:00–06:00) for the days spanning the interval, in case of
  // an overnight shift.
  const nightWindows = [-1, 0, 1].map((n) => {
    const d = addDaysToDateStr(referenceDate, n)
    const nd = addDaysToDateStr(referenceDate, n + 1)
    return { start: toBADateTime(d, NIGHT_START), end: toBADateTime(nd, NIGHT_END) }
  })

  // Scheduled window for referenceDate (used to tell "normal" from "extra" on
  // weekdays). Handles an overnight schedule (end time before start time).
  let winStartMs: number | null = null
  let winEndMs: number | null = null
  if (hasSchedule && scheduledStart && scheduledEnd) {
    winStartMs = toBADateTime(referenceDate, scheduledStart)
    winEndMs = toBADateTime(referenceDate, scheduledEnd)
    if (winEndMs <= winStartMs) winEndMs += 24 * 3_600_000
  }

  // Breakpoints: night window edges + scheduled window edges, clipped to the interval.
  const breakpoints = new Set<number>([intervalStartMs, intervalEndMs])
  for (const w of nightWindows) {
    if (w.start > intervalStartMs && w.start < intervalEndMs) breakpoints.add(w.start)
    if (w.end > intervalStartMs && w.end < intervalEndMs) breakpoints.add(w.end)
  }
  if (winStartMs !== null && winEndMs !== null) {
    if (winStartMs > intervalStartMs && winStartMs < intervalEndMs) breakpoints.add(winStartMs)
    if (winEndMs > intervalStartMs && winEndMs < intervalEndMs) breakpoints.add(winEndMs)
  }

  const points = [...breakpoints].sort((a, b) => a - b)

  let normalMs = 0, extra50Ms = 0, extra100Ms = 0, nightMs = 0
  let consumedSaturdayMs = 0 // cumulative non-night Saturday hours worked, across segments

  for (let i = 0; i < points.length - 1; i++) {
    const segStart = points[i]
    const segEnd = points[i + 1]
    const dur = segEnd - segStart
    if (dur <= 0) continue
    const mid = (segStart + segEnd) / 2

    const isNight = nightWindows.some((w) => mid >= w.start && mid < w.end)
    if (isNight) {
      nightMs += dur
      continue
    }

    const baMid = new Date(mid - 3 * 3_600_000)
    const segDate = baMid.toISOString().split('T')[0]
    const segWeekday = weekdayOf(segDate)

    if (isHoliday || segWeekday === 'SUNDAY') {
      extra100Ms += dur
      continue
    }

    if (segWeekday === 'SATURDAY') {
      const remaining = SATURDAY_100_AFTER_MS - consumedSaturdayMs
      if (remaining <= 0) {
        extra100Ms += dur
      } else if (dur <= remaining) {
        normalMs += dur
        consumedSaturdayMs += dur
      } else {
        normalMs += remaining
        extra100Ms += dur - remaining
        consumedSaturdayMs += remaining
      }
      continue
    }

    // Weekday (Mon–Fri).
    if (winStartMs === null || winEndMs === null) {
      // No schedule → don't infer extras, everything worked is "normal".
      normalMs += dur
      continue
    }
    const inWindow = segDate === referenceDate && mid >= winStartMs && mid < winEndMs
    if (inWindow) normalMs += dur; else extra50Ms += dur
  }

  return {
    normalHours: normalMs / 3_600_000,
    extra50Hours: extra50Ms / 3_600_000,
    extra100Hours: extra100Ms / 3_600_000,
    nightHours: nightMs / 3_600_000,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Status derivation
// ─────────────────────────────────────────────────────────────────────────────

function getDayStatus(
  summary: HumandDaySummary,
  isAutoClose: boolean,
  isEnCurso: boolean
): DayStatus {
  if (summary.holidays.length > 0) return 'holiday'
  if (summary.timeOffRequests.length > 0) return 'timeoff'
  if (summary.entries.length > 0) {
    if (isEnCurso) return 'encurso'
    return isAutoClose ? 'autoclose' : 'present'
  }
  if (summary.hasSchedule && summary.isWorkday) return 'absent'
  return 'dayoff'
}

// ─────────────────────────────────────────────────────────────────────────────
// Matrix builder
// ─────────────────────────────────────────────────────────────────────────────

export function buildMatrixData(
  employees: HumandEmployee[],
  summaries: HumandDaySummary[],
  startDate: string,
  endDate: string
): MatrixData {
  const dates: string[] = []
  const cur = new Date(startDate + 'T12:00:00Z')
  const end = new Date(endDate + 'T12:00:00Z')
  while (cur <= end) {
    dates.push(cur.toISOString().split('T')[0])
    cur.setUTCDate(cur.getUTCDate() + 1)
  }

  const idx: Record<string, HumandDaySummary> = {}
  for (const s of summaries) idx[`${s.employeeId}_${s.referenceDate}`] = s

  const empMap: Record<string, HumandEmployee> = {}
  for (const e of employees) empMap[e.employeeInternalId] = e

  const activeIds = [...new Set(summaries.map((s) => s.employeeId))]

  const matrixEmployees: MatrixEmployee[] = activeIds.map((eid) => {
    const emp = empMap[eid]
    const segs: Record<string, string> = {}
    for (const s of emp?.segmentations ?? []) segs[s.group] = s.item

    const days: Record<string, MatrixDay> = {}
    let totalCorrectedHours = 0
    let totalScheduledHours = 0
    let totalNormalHours = 0
    let totalExtra50Hours = 0
    let totalExtra100Hours = 0
    let totalNightHours = 0
    let daysPresent = 0
    let daysAbsent = 0
    let autoCloseDays = 0
    let holidayDays = 0
    let timeOffDays = 0
    let enCursoDays = 0

    for (const date of dates) {
      const summary = idx[`${eid}_${date}`]
      if (!summary) {
        days[date] = {
          status: 'dayoff', correctedHours: null, rawHours: 0,
          normalHours: 0, extra50Hours: 0, extra100Hours: 0, nightHours: 0,
          isAutoClose: false, isEnCurso: false,
          holidayName: null, timeOffName: null,
          weekday: '', isWorkday: false, hasSchedule: false,
          scheduledStart: null, scheduledEnd: null,
          entry1: null, exit1: null, entry2: null, exit2: null,
          exit1Source: null, exit2Source: null, entry1Source: null, entry2Source: null,
          sites: [], incidences: [],
        }
        continue
      }

      const { correctedHours, isAutoClose, isEnCurso, session1IsCarryover, intervalStartMs, intervalEndMs } =
        computeCorrectedHours(summary.entries, summary.timeSlots, date)

      const status = getDayStatus(summary, isAutoClose, isEnCurso)

      const slots = (summary.timeSlots ?? []).sort((a, b) => a.id - b.id)
      const scheduledStart = slots.length > 0 ? slots[0].startTime : null
      const scheduledEnd = slots.length > 0 ? slots[slots.length - 1].endTime : null
      const scheduledHours = slots.reduce((sum, s) => {
        return sum + (toBADateTime(date, s.endTime) - toBADateTime(date, s.startTime)) / 3_600_000
      }, 0)

      const { normalHours, extra50Hours, extra100Hours, nightHours } = computeHourBreakdown(
        intervalStartMs, intervalEndMs, scheduledStart, scheduledEnd, summary.hasSchedule, date,
        summary.holidays.length > 0
      )

      const sorted = [...summary.entries].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
      const sortedStarts = sorted.filter((e) => e.type === 'START')
      const sortedEnds = sorted.filter((e) => e.type === 'END')
      const sites = [...new Set(sorted.filter((e) => e.site?.name).map((e) => e.site!.name))]

      // When session 1 is a DAY_CHANGE carryover artifact, skip it for display purposes
      // so the tooltip and records only show the real session (session 2).
      const dispStarts = session1IsCarryover ? sortedStarts.slice(1) : sortedStarts
      const dispEnds = session1IsCarryover ? sortedEnds.slice(1) : sortedEnds

      days[date] = {
        status,
        correctedHours,
        rawHours: summary.hours.worked,
        normalHours, extra50Hours, extra100Hours, nightHours,
        isAutoClose,
        isEnCurso,
        holidayName: summary.holidays[0]?.name ?? null,
        timeOffName: summary.timeOffRequests[0]?.name ?? null,
        weekday: summary.weekday,
        isWorkday: summary.isWorkday,
        hasSchedule: summary.hasSchedule,
        scheduledStart,
        scheduledEnd,
        entry1: dispStarts[0] ? toBATime(dispStarts[0].time) : null,
        exit1: dispEnds[0] ? toBATime(dispEnds[0].time) : null,
        entry2: dispStarts[1] ? toBATime(dispStarts[1].time) : null,
        exit2: dispEnds[1] ? toBATime(dispEnds[1].time) : null,
        exit1Source: dispEnds[0]?.source ?? null,
        exit2Source: dispEnds[1]?.source ?? null,
        entry1Source: dispStarts[0]?.source ?? null,
        entry2Source: dispStarts[1]?.source ?? null,
        sites,
        incidences: summary.incidences,
      }

      if (correctedHours !== null) totalCorrectedHours += correctedHours
      totalScheduledHours += scheduledHours
      totalNormalHours += normalHours
      totalExtra50Hours += extra50Hours
      totalExtra100Hours += extra100Hours
      totalNightHours += nightHours
      if (status === 'present' || status === 'autoclose' || status === 'encurso') daysPresent++
      if (status === 'absent') daysAbsent++
      if (isAutoClose) autoCloseDays++
      if (status === 'holiday') holidayDays++
      if (status === 'timeoff') timeOffDays++
      if (isEnCurso) enCursoDays++
    }

    const name = emp ? `${emp.firstName} ${emp.lastName}` : eid

    return {
      employeeId: eid,
      name,
      location: segs['Ubicación'] ?? 'Sin sucursal',
      area: segs['Área'] ?? '',
      puesto: segs['Puesto'] ?? '',
      days,
      totals: {
        correctedHours: totalCorrectedHours,
        scheduledHours: totalScheduledHours,
        normalHours: totalNormalHours,
        extra50Hours: totalExtra50Hours,
        extra100Hours: totalExtra100Hours,
        nightHours: totalNightHours,
        daysPresent,
        daysAbsent,
        autoCloseDays,
        holidayDays,
        timeOffDays,
        enCursoDays,
      },
    }
  })

  matrixEmployees.sort((a, b) => {
    const loc = a.location.localeCompare(b.location)
    return loc !== 0 ? loc : a.name.localeCompare(b.name)
  })

  return { employees: matrixEmployees, dates }
}
