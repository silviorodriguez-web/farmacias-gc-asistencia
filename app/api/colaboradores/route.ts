import { NextResponse } from 'next/server'
import { runQuery } from '@/lib/redash'
import { ColaboradorOption } from '@/lib/types'

const QUERY_ID = parseInt(process.env.REDASH_COLABORADORES_QUERY_ID ?? '39455')

export async function GET() {
  try {
    const rows = await runQuery(QUERY_ID, {}, 3600)
    return NextResponse.json({ options: rows as ColaboradorOption[] })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
