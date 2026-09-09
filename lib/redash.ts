const BASE = process.env.REDASH_BASE_URL!
const API_KEY = process.env.REDASH_API_KEY!

async function pollJob(jobId: string): Promise<unknown[]> {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, i < 6 ? 400 : 800))
    const res = await fetch(`${BASE}/api/jobs/${jobId}`, {
      headers: { Authorization: `Key ${API_KEY}` },
      cache: 'no-store',
    })
    const { job } = await res.json()
    if (job.status === 3) {
      const r2 = await fetch(`${BASE}/api/query_results/${job.query_result_id}`, {
        headers: { Authorization: `Key ${API_KEY}` },
        cache: 'no-store',
      })
      const data = await r2.json()
      return data.query_result.data.rows as unknown[]
    }
    if (job.status === 4) throw new Error(`Redash job failed: ${job.error}`)
  }
  throw new Error('Redash query timed out')
}

export async function runQuery(
  queryId: number,
  parameters: Record<string, string> = {},
  maxAge = 0
): Promise<unknown[]> {
  const res = await fetch(`${BASE}/api/queries/${queryId}/results`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ parameters, apply_auto_limit: false, max_age: maxAge }),
    cache: 'no-store',
  })
  const data = await res.json()
  if (data.query_result) return data.query_result.data.rows as unknown[]
  if (data.job) return pollJob(data.job.id)
  throw new Error(`Unexpected Redash response: ${JSON.stringify(data).slice(0, 200)}`)
}
