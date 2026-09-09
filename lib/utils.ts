import { AttendanceRow } from './types'

export const REAL_SOURCES = new Set(['APP', 'QR', 'MANUAL', 'FACE_ID', 'GPS', 'BEACON', 'NFC'])

export function isRealSource(source: string | null): boolean {
  if (!source) return false
  return REAL_SOURCES.has(source.split(' ')[0])
}

export function isAutoCloseSource(source: string | null): boolean {
  if (!source) return false
  const base = source.split(' ')[0]
  return !REAL_SOURCES.has(base)
}

export function rowHasAutoClose(row: AttendanceRow): boolean {
  return (
    isAutoCloseSource(row['Mét. Sal. 1']) ||
    isAutoCloseSource(row['Mét. Sal. 2'])
  )
}

// Absent = has a scheduled shift but no clock-in entries (and no holiday/licencia)
export function rowIsAbsent(row: AttendanceRow): boolean {
  return (
    !row.Feriado &&
    !row.Licencia &&
    !row['Ent. 1'] &&
    row['Hr. Prog. Ent.'] !== null
  )
}

export function getSourceLabel(source: string | null): string {
  if (!source) return '—'
  const map: Record<string, string> = {
    APP: 'App',
    QR: 'QR',
    MANUAL: 'Manual',
    FACE_ID: 'Face ID',
    GPS: 'GPS',
    BEACON: 'Beacon',
    NFC: 'NFC',
    AUTO_CLOSE: 'Auto',
    DAY_CHANGE: 'Cambio día',
  }
  const base = source.split(' (')[0]
  const suffix = source.includes('(') ? ' ' + source.slice(source.indexOf('(')) : ''
  return (map[base] ?? base) + suffix
}

export function formatHours(hrs: string | null): string {
  if (!hrs) return '—'
  const n = parseFloat(hrs)
  if (isNaN(n)) return hrs
  const h = Math.floor(n)
  const m = Math.round((n - h) * 60)
  return `${h}h ${m.toString().padStart(2, '0')}m`
}

export function sumHours(rows: AttendanceRow[]): number {
  return rows.reduce((acc, r) => {
    const n = parseFloat(r['Hrs. Trab.'] ?? '0')
    return acc + (isNaN(n) ? 0 : n)
  }, 0)
}

export function getTodayString(): string {
  return new Date().toISOString().split('T')[0]
}

export function getFirstDayOfMonth(): string {
  const d = new Date()
  d.setDate(1)
  return d.toISOString().split('T')[0]
}

export function subtractDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().split('T')[0]
}
