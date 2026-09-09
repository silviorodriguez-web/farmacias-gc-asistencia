import { NextRequest, NextResponse } from 'next/server'
import { runQuery } from '@/lib/redash'
import { AttendanceRow } from '@/lib/types'

const QUERY_ID = parseInt(process.env.REDASH_ATTENDANCE_QUERY_ID ?? '39458')

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const fecha_inicio = searchParams.get('fecha_inicio') ?? ''
  const fecha_fin = searchParams.get('fecha_fin') ?? ''
  const colaborador = searchParams.get('colaborador') ?? '%'

  if (!fecha_inicio || !fecha_fin) {
    return NextResponse.json({ error: 'fecha_inicio y fecha_fin son requeridos' }, { status: 400 })
  }

  try {
    const rows = await runQuery(QUERY_ID, { fecha_inicio, fecha_fin, colaborador })
    return NextResponse.json({ rows: rows as AttendanceRow[] })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
