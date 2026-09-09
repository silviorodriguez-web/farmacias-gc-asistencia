import { NextRequest, NextResponse } from 'next/server'
import { fetchAllEmployees, fetchAllDaySummaries, buildMatrixData } from '@/lib/humand'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const startDate = searchParams.get('startDate') ?? ''
  const endDate = searchParams.get('endDate') ?? ''

  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'startDate y endDate son requeridos' }, { status: 400 })
  }

  try {
    const employees = await fetchAllEmployees()
    const employeeIds = employees.map((e) => e.employeeInternalId)
    const summaries = await fetchAllDaySummaries(employeeIds, startDate, endDate)
    const matrix = buildMatrixData(employees, summaries, startDate, endDate)
    return NextResponse.json(matrix)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
