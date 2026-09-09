export interface AttendanceRow {
  Fecha: string
  'Día': string
  Colaborador: string
  'Hr. Prog. Ent.': string | null
  'Hr. Prog. Sal.': string | null
  'Ent. 1': string | null
  'Sal. 1': string | null
  'Ent. 2': string | null
  'Sal. 2': string | null
  Almuerzo: string | null
  'Hrs. Trab.': string | null
  'Mét. Ent. 1': string | null
  'Mét. Sal. 1': string | null
  'Mét. Ent. 2': string | null
  'Mét. Sal. 2': string | null
  Feriado: string | null
  Licencia: string | null
}

export interface ColaboradorOption {
  name: string
  label: string
}

export interface AttendanceFilters {
  fecha_inicio: string
  fecha_fin: string
  colaborador: string
}
