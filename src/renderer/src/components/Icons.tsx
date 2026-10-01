import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }
const base = (size = 16): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
})

const icon =
  (d: string | string[]) =>
  ({ size, ...p }: P) => (
    <svg {...base(size)} {...p} aria-hidden>
      {(Array.isArray(d) ? d : [d]).map((x) => (
        <path key={x} d={x} />
      ))}
    </svg>
  )

export const IPlay = icon('M7 4.5v15l12.5-7.5z')
export const IStop = icon('M6 6h12v12H6z')
export const IDownload = icon(['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'])
export const IHome = icon(['M4 11l8-7 8 7', 'M6 10v10h12V10'])
export const IPlus = icon(['M12 5v14', 'M5 12h14'])
export const IFolder = icon('M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z')
export const ISettings = icon([
  'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'
])
export const IUndo = icon(['M9 14L4 9l5-5', 'M4 9h11a5 5 0 0 1 0 10h-3'])
export const IRedo = icon(['M15 14l5-5-5-5', 'M20 9H9a5 5 0 0 0 0 10h3'])
export const ITrash = icon(['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'])
export const ICopy = icon(['M9 9h11v11H9z', 'M5 15H4V4h11v1'])
export const IX = icon(['M6 6l12 12', 'M18 6L6 18'])
export const IBan = icon(['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M5.6 5.6l12.8 12.8'])
export const ISearch = icon(['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-4-4'])
export const IAlert = icon(['M12 3l10 18H2z', 'M12 10v5', 'M12 18h.01'])
export const ICheck = icon('M5 12l5 5 9-10')
export const IChevron = icon('M9 6l6 6-6 6')
export const ITerminal = icon(['M4 6l6 6-6 6', 'M12 19h8'])
export const IFit = icon(['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'])
export const IUpload = icon(['M12 20V9', 'M7 14l5-5 5 5', 'M5 4h14'])
export const IGlobe = icon(['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M3 12h18', 'M12 3a14 14 0 0 1 0 18', 'M12 3a14 14 0 0 0 0 18'])

/** NKW logo: a stylised block with the group initials. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="NKW">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--accent)" />
      <path
        d="M5 20.5v-9l4.2 9v-9M12.4 11.5v9M12.4 17l4.4-5.5M14.2 14.8l2.8 5.7M18.6 11.5l1.7 9 1.9-6.2 1.9 6.2 1.7-9"
        stroke="var(--accent-fg)"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}
