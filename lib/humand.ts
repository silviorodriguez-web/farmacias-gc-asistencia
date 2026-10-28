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

function slotRangeMs(sl: HumandTimeSlot, date: string): [number, number] {
  const start = toBADateTime(date, sl.startTime)
  let end = toBADateTime(date, sl.endTime)
  if (end <= start) end += 24 * 3_600_000
  return [start, end]
}

// A shift change ("Cambio Horario") replaces the scheduled shift for that day:
// when slots overlap, only the newest one (highest id) is kept. Non-overlapping
// slots (split shifts) are all kept. Result is sorted by start time.
export function sortSlotsByStart(timeSlots: HumandTimeSlot[] | null, date: string): HumandTimeSlot[] {
  const byNewest = [...(timeSlots ?? [])].sort((a, b) => b.id - a.id)
  const kept: HumandTimeSlot[] = []
  for (const sl of byNewest) {
    const [st, en] = slotRangeMs(sl, date)
    const overlaps = kept.some((k) => {
      const [kst, ken] = slotRangeMs(k, date)
      return st < ken && kst < en
    })
    if (!overlaps) kept.push(sl)
  }
  return kept.sort((a, b) => slotRangeMs(a, date)[0] - slotRangeMs(b, date)[0])
}

export function scheduledTotalMs(slots: HumandTimeSlot[], date: string): number {
  return slots.reduce((sum, sl) => {
    const [st, en] = slotRangeMs(sl, date)
    return sum + (en - st)
  }, 0)
}

function scheduledEndMsFor(slots: HumandTimeSlot[], date: string, fromMs: number): number | null {
  if (slots.length === 0) return null
  let lastEnd = 0
  for (const s of slots) {
    const startMs = toBADateTime(date, s.startTime)
    let endMs = toBADateTime(date, s.endTime)
    if (endMs <= startMs) endMs += 24 * 3_600_000
    lastEnd = endMs
    if (endMs > fromMs) return endMs
  }
  return lastEnd
}

export interface SessionInterval {
  startMs: number
  endMs: number
}

function sumIntervalsHours(intervals: SessionInterval[]): number {
  return intervals.reduce((sum, iv) => sum + Math.max(0, iv.endMs - iv.startMs), 0) / 3_600_000
}

export function computeCorrectedHours(
  entries: HumandEntry[],
  timeSlots: HumandTimeSlot[] | null,
  referenceDate: string
): {
  correctedHours: number | null
  isAutoClose: boolean
  isEnCurso: boolean
  session1IsCarryover: boolean
  intervals: SessionInterval[]
} {
  const NO = {
    correctedHours: null, isAutoClose: false, isEnCurso: false, session1IsCarryover: false,
    intervals: [] as SessionInterval[],
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
  const slots = sortSlotsByStart(timeSlots, referenceDate)
  // Scheduled end of the slot that covers the open session (so a split shift
  // in its afternoon block is estimated to the afternoon end, not the morning one).
  const progEndMs = (fromMs: number): number | null => scheduledEndMsFor(slots, referenceDate, fromMs)

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
      const intervals = [{ startMs: realStartMs, endMs }]
      return {
        correctedHours: sumIntervalsHours(intervals),
        isAutoClose: !isReal(salida2.source),
        isEnCurso: false,
        session1IsCarryover: true,
        intervals,
      }
    }
    // Session 2 is open → en curso, estimate to scheduled end
    const carryEndMs = progEndMs(realStartMs)
    if (carryEndMs !== null) {
      const endMs = carryEndMs
      const intervals = [{ startMs: realStartMs, endMs }]
      return {
        correctedHours: sumIntervalsHours(intervals),
        isAutoClose: true,
        isEnCurso: true,
        session1IsCarryover: true,
        intervals,
      }
    }
    return {
      correctedHours: null, isAutoClose: false, isEnCurso: true, session1IsCarryover: true,
      intervals: [],
    }
  }

  const entry1Ms = new Date(entrada1.time).getTime()

  // ── CASE: Session 2 open (En Curso) ──────────────────────────────────────
  // New case beyond Redash SQL: session 2 started but no exit yet.
  // Common when employee is currently working (real APP session started).
  if (salida2 === null && entrada2 !== null) {
    const open2EndMs = progEndMs(new Date(entrada2.time).getTime())
    if (open2EndMs !== null) {
      const endMs = open2EndMs
      // If session 1 was a non-real source (but not DAY_CHANGE handled above),
      // ignore it entirely and count only session 2, to avoid including the
      // overnight/artifact gap.
      if (!isReal(entrada1.source)) {
        const startMs = new Date(entrada2.time).getTime()
        const intervals = [{ startMs, endMs }]
        return {
          correctedHours: sumIntervalsHours(intervals),
          isAutoClose: true,
          isEnCurso: isReal(entrada2.source),
          session1IsCarryover: false,
          intervals,
        }
      }
      // Session 1 is real. If it was closed (salida1 exists), that's a break
      // (e.g. lunch) — count session 1 and session 2 separately so the break
      // in between is excluded.
      const intervals: SessionInterval[] = salida1 !== null
        ? [{ startMs: entry1Ms, endMs: new Date(salida1.time).getTime() }, { startMs: new Date(entrada2.time).getTime(), endMs }]
        : [{ startMs: entry1Ms, endMs }]
      return {
        correctedHours: sumIntervalsHours(intervals),
        isAutoClose: true,
        isEnCurso: isReal(entrada2.source),
        session1IsCarryover: false,
        intervals,
      }
    }
    // No prog time — fall through to session 1 calculation
  }

  // ── Redash SQL cases ──────────────────────────────────────────────────────
  // Both sessions closed. Count session 1 (entrada1→salida1) and session 2
  // (entrada2→salida2) separately so the break between them (lunch, etc.) is
  // never counted as worked time.
  if (salida2 !== null) {
    // Two exits but a single entry (stray/duplicate END): one session, entry1 → last exit.
    const sessionStartMs = new Date((entrada2 ?? entrada1).time).getTime()
    const schedEndMs = progEndMs(sessionStartMs)
    const usesSalida2Time = isReal(salida2.source) || schedEndMs === null
    const endMs = usesSalida2Time ? new Date(salida2.time).getTime() : schedEndMs!
    const intervals: SessionInterval[] = entrada2 === null
      ? [{ startMs: entry1Ms, endMs }]
      : [
          { startMs: entry1Ms, endMs: new Date(salida1!.time).getTime() },
          { startMs: sessionStartMs, endMs },
        ]
    return {
      correctedHours: sumIntervalsHours(intervals),
      isAutoClose: !usesSalida2Time || !isReal(salida2.source),
      isEnCurso: false,
      session1IsCarryover: false,
      intervals,
    }
  }

  if (salida1 !== null) {
    const endMs = new Date(salida1.time).getTime()
    const intervals = [{ startMs: entry1Ms, endMs }]
    return {
      correctedHours: sumIntervalsHours(intervals),
      isAutoClose: !isReal(salida1.source),
      isEnCurso: false,
      session1IsCarryover: false,
      intervals,
    }
  }

  const singleEndMs = progEndMs(entry1Ms)
  if (singleEndMs !== null) {
    const endMs = singleEndMs
    const intervals = [{ startMs: entry1Ms, endMs }]
    return {
      correctedHours: sumIntervalsHours(intervals),
      isAutoClose: true,
      isEnCurso: false,
      session1IsCarryover: false,
      intervals,
    }
  }

  return NO
}

// ─────────────────────────────────────────────────────────────────────────────
// Hour type breakdown — normal / extra 50% / extra 100% / nocturnas
//
// Rules (confirmed with client, 2026-09-11 correction from Paula Ferro):
//  - Normal: hours worked on a weekday (Mon–Fri) up to the day's scheduled
//    hours (sum of the day's time slots), regardless of when they were worked.
//    If the day has no schedule at all, everything worked is "normal" (no
//    extras are inferred) — flag for manual payroll review.
//  - Extra 50%: hours worked on a weekday beyond the day's scheduled hours,
//    up to 21:00 (hours from 21:00 on are pulled into "nocturnas").
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
  intervals: SessionInterval[],
  scheduledMs: number | null,
  referenceDate: string,
  isHoliday: boolean
): HourBreakdown {
  const zero = { normalHours: 0, extra50Hours: 0, extra100Hours: 0, nightHours: 0 }
  const validIntervals = intervals.filter((iv) => iv.endMs > iv.startMs).sort((a, b) => a.startMs - b.startMs)
  if (validIntervals.length === 0) return zero

  // Night windows (21:00–06:00) for the days spanning the intervals, in case of
  // an overnight shift.
  const nightWindows = [-1, 0, 1].map((n) => {
    const d = addDaysToDateStr(referenceDate, n)
    const nd = addDaysToDateStr(referenceDate, n + 1)
    return { start: toBADateTime(d, NIGHT_START), end: toBADateTime(nd, NIGHT_END) }
  })

  let normalMs = 0, extra50Ms = 0, extra100Ms = 0, nightMs = 0
  // Cumulative non-night Saturday hours worked, across all sessions of the day
  // (so the 5h threshold applies to the whole day, not per session).
  let consumedSaturdayMs = 0
  // Cumulative non-night weekday hours worked, to tell "normal" from "extra 50%".
  let consumedWeekdayMs = 0

  for (const { startMs: intervalStartMs, endMs: intervalEndMs } of validIntervals) {
    // Breakpoints: night window edges, clipped to the interval.
    const breakpoints = new Set<number>([intervalStartMs, intervalEndMs])
    for (const w of nightWindows) {
      if (w.start > intervalStartMs && w.start < intervalEndMs) breakpoints.add(w.start)
      if (w.end > intervalStartMs && w.end < intervalEndMs) breakpoints.add(w.end)
    }

    const points = [...breakpoints].sort((a, b) => a - b)

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
      if (scheduledMs === null) {
        // No schedule → don't infer extras, everything worked is "normal".
        normalMs += dur
        continue
      }
      const remaining = scheduledMs - consumedWeekdayMs
      if (remaining <= 0) {
        extra50Ms += dur
      } else if (dur <= remaining) {
        normalMs += dur
        consumedWeekdayMs += dur
      } else {
        normalMs += remaining
        extra50Ms += dur - remaining
        consumedWeekdayMs += remaining
      }
    }
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

  const emptyDay = (): MatrixDay => ({
    status: 'dayoff', correctedHours: null, rawHours: 0,
    normalHours: 0, extra50Hours: 0, extra100Hours: 0, nightHours: 0,
    isAutoClose: false, isEnCurso: false,
    holidayName: null, timeOffName: null,
    weekday: '', isWorkday: false, hasSchedule: false,
    scheduledStart: null, scheduledEnd: null,
    entry1: null, exit1: null, entry2: null, exit2: null,
    exit1Source: null, exit2Source: null, entry1Source: null, entry2Source: null,
    sites: [], incidences: [],
  })

  const normSite = (s: string) => s.trim().toLowerCase()
  const sameSite = (a: string, b: string) => {
    const x = normSite(a), y = normSite(b)
    return x === y || x.includes(y) || y.includes(x)
  }

  const matrixEmployees: MatrixEmployee[] = activeIds.flatMap((eid) => {
    const emp = empMap[eid]
    const segs: Record<string, string> = {}
    for (const s of emp?.segmentations ?? []) segs[s.group] = s.item
    // An employee can have several "Ubicación" items (works in more than one branch).
    const locations = [...new Set(
      (emp?.segmentations ?? []).filter((s) => s.group === 'Ubicación').map((s) => s.item)
    )]
    if (locations.length === 0) locations.push('Sin sucursal')

    const days: Record<string, MatrixDay> = {}
    const scheduledByDate: Record<string, number> = {}

    for (const date of dates) {
      const summary = idx[`${eid}_${date}`]
      if (!summary) {
        days[date] = emptyDay()
        continue
      }

      const { correctedHours, isAutoClose, isEnCurso, session1IsCarryover, intervals } =
        computeCorrectedHours(summary.entries, summary.timeSlots, date)

      const status = getDayStatus(summary, isAutoClose, isEnCurso)

      const slots = sortSlotsByStart(summary.timeSlots, date)
      const scheduledStart = slots.length > 0 ? slots[0].startTime : null
      const scheduledEnd = slots.length > 0 ? slots[slots.length - 1].endTime : null
      const scheduledMs = scheduledTotalMs(slots, date)
      const scheduledHours = scheduledMs / 3_600_000

      const { normalHours, extra50Hours, extra100Hours, nightHours } = computeHourBreakdown(
        intervals, summary.hasSchedule && scheduledMs > 0 ? scheduledMs : null, date,
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

      scheduledByDate[date] = scheduledHours
    }

    const name = emp ? `${emp.firstName} ${emp.lastName}` : eid

    // Each day belongs to the branch where the employee clocked in; days with no
    // matching clock-in site (absences, days off) go to the first listed branch.
    const dayLocation = (date: string): string => {
      if (locations.length === 1) return locations[0]
      const sites = days[date].sites
      return locations.find((l) => sites.some((s) => sameSite(s, l))) ?? locations[0]
    }

    return locations.map((location): MatrixEmployee => {
      const ownDays: Record<string, MatrixDay> = {}
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
        const day = days[date]
        if (dayLocation(date) !== location) {
          ownDays[date] = emptyDay()
          continue
        }
        ownDays[date] = day
        if (day.correctedHours !== null) totalCorrectedHours += day.correctedHours
        totalScheduledHours += scheduledByDate[date] ?? 0
        totalNormalHours += day.normalHours
        totalExtra50Hours += day.extra50Hours
        totalExtra100Hours += day.extra100Hours
        totalNightHours += day.nightHours
        if (day.status === 'present' || day.status === 'autoclose' || day.status === 'encurso') daysPresent++
        if (day.status === 'absent') daysAbsent++
        if (day.isAutoClose) autoCloseDays++
        if (day.status === 'holiday') holidayDays++
        if (day.status === 'timeoff') timeOffDays++
        if (day.isEnCurso) enCursoDays++
      }

      return {
        employeeId: eid,
        name,
        location,
        area: segs['Área'] ?? '',
        puesto: segs['Puesto'] ?? '',
        days: ownDays,
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
  })

  matrixEmployees.sort((a, b) => {
    const loc = a.location.localeCompare(b.location)
    return loc !== 0 ? loc : a.name.localeCompare(b.name)
  })

  return { employees: matrixEmployees, dates }
}
