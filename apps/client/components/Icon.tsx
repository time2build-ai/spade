import * as React from "react";

const PATHS = {
  brain: (
    <>
      <path d="M8 2.5a2 2 0 0 0-2 2v.2a2 2 0 0 0-2 1.8 2 2 0 0 0 .5 1.3A2 2 0 0 0 4 9.6a2 2 0 0 0 2 2v.2a2 2 0 0 0 4 0v-.2a2 2 0 0 0 2-2 2 2 0 0 0-.5-1.8A2 2 0 0 0 12 6.5a2 2 0 0 0-2-1.8v-.2a2 2 0 0 0-2-2Z" />
      <path d="M8 4.5v7" />
    </>
  ),
  tasks: (
    <>
      <rect x="2" y="3" width="12" height="2.5" rx="1" />
      <rect x="2" y="6.75" width="9" height="2.5" rx="1" />
      <rect x="2" y="10.5" width="6" height="2.5" rx="1" />
    </>
  ),
  board: (
    <>
      <rect x="2" y="2.5" width="3.5" height="11" rx="1" />
      <rect x="6.25" y="2.5" width="3.5" height="7" rx="1" />
      <rect x="10.5" y="2.5" width="3.5" height="9" rx="1" />
    </>
  ),
  orch: (
    <>
      <circle cx="3.5" cy="3.5" r="1.5" />
      <circle cx="12.5" cy="3.5" r="1.5" />
      <circle cx="3.5" cy="12.5" r="1.5" />
      <circle cx="12.5" cy="12.5" r="1.5" />
      <path d="M5 3.5h6M3.5 5v6M12.5 5v6M5 12.5h6" />
    </>
  ),
  mic: (
    <>
      <rect x="6" y="2" width="4" height="8" rx="2" />
      <path d="M3.5 8a4.5 4.5 0 0 0 9 0M8 12.5v2" />
    </>
  ),
  gate: (
    <>
      <rect x="3" y="6.5" width="10" height="7" rx="1.5" />
      <path d="M5 6.5V5a3 3 0 0 1 6 0v1.5" />
    </>
  ),
  term: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="m4.5 6.5 2 1.5-2 1.5M8 10h3.5" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4" />
      <path d="m13 13-3-3" />
    </>
  ),
  link: (
    <>
      <path d="M6.5 9.5 9.5 6.5" />
      <path d="M7 4.5 8.5 3a3 3 0 0 1 4.2 4.2L11.5 8.5" />
      <path d="M9 11.5 7.5 13a3 3 0 0 1-4.2-4.2L4.5 7.5" />
    </>
  ),
  doc: (
    <>
      <path d="M3.5 2.5h6l3 3v8a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z" />
      <path d="M9.5 2.5v3h3" />
      <path d="M5.5 8h5M5.5 10.5h5M5.5 13H8" />
    </>
  ),
  flag: (
    <>
      <path d="M3.5 2.5v11" />
      <path d="M3.5 3h7l-1.5 2.5L10.5 8H3.5" />
    </>
  ),
  x: <path d="m4 4 8 8M12 4l-8 8" />,
  check: <path d="m3.5 8.5 3 3 6-7" />,
  play: <path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none" />,
  spark: <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M4 12l2-2M10 6l2-2" />,
  cog: (
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8 3.4 3.4" />
    </>
  ),
  graph: (
    <>
      <circle cx="3.5" cy="3.5" r="1.5" />
      <circle cx="12.5" cy="3.5" r="1.5" />
      <circle cx="8" cy="8.5" r="1.5" />
      <circle cx="3.5" cy="13" r="1.5" />
      <circle cx="12.5" cy="13" r="1.5" />
      <path d="M5 4.5 7 7M11 4.5 9 7M7 10 5 12M9 10l2 2" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  arrow: <path d="M3 8h10M9 4l4 4-4 4" />,
  chev: <path d="m4 6 4 4 4-4" />,
  cal: (
    <>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M5 2v3M11 2v3" />
    </>
  ),
  bolt: <path d="M9 2 3.5 9h4L7 14l5.5-7h-4z" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 14,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
