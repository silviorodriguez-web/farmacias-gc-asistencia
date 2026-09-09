'use client'

import { isRealSource, getSourceLabel } from '@/lib/utils'

interface Props {
  source: string | null
}

const BADGE_STYLES: Record<string, string> = {
  APP: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  QR: 'bg-teal-100 text-teal-800 border-teal-200',
  MANUAL: 'bg-sky-100 text-sky-800 border-sky-200',
  FACE_ID: 'bg-violet-100 text-violet-800 border-violet-200',
  GPS: 'bg-blue-100 text-blue-800 border-blue-200',
  BEACON: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  NFC: 'bg-cyan-100 text-cyan-800 border-cyan-200',
}

export default function MethodBadge({ source }: Props) {
  if (!source) return <span className="text-gray-300">—</span>

  const base = source.split(' (')[0]
  const isReal = isRealSource(source)
  const style = BADGE_STYLES[base] ??
    (isReal ? 'bg-green-100 text-green-800 border-green-200'
             : 'bg-orange-100 text-orange-800 border-orange-200')

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${style} whitespace-nowrap`}>
      {getSourceLabel(source)}
    </span>
  )
}
