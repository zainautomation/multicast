// Inline stroke icons from the approved design (no icon font, no emoji).
const base = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const IconCompose = () => (
  <svg {...base}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
export const IconSchedule = () => (
  <svg {...base}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
    <path d="M12 14v3l2 1" />
  </svg>
);
export const IconPrompts = () => (
  <svg {...base}>
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
    <circle cx="9" cy="6" r="2" fill="#1B1A17" />
    <circle cx="15" cy="12" r="2" fill="#1B1A17" />
    <circle cx="7" cy="18" r="2" fill="#1B1A17" />
  </svg>
);
export const IconBrand = () => (
  <svg {...base}>
    <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.5-1.5 0-.9-.7-1.2-.7-2.1 0-.8.7-1.4 1.5-1.4H17a4 4 0 0 0 4-4c0-5-4-9-9-9Z" />
    <circle cx="7.5" cy="11" r="1" />
    <circle cx="10" cy="7" r="1" />
    <circle cx="15" cy="7.5" r="1" />
  </svg>
);
export const IconPlug = () => (
  <svg {...base}>
    <path d="M9 7V3" />
    <path d="M15 7V3" />
    <path d="M6 7h12v4a6 6 0 0 1-12 0Z" />
    <path d="M12 17v4" />
  </svg>
);
export const IconKey = () => (
  <svg {...base}>
    <circle cx="8" cy="15" r="4" />
    <path d="m10.8 12.2 8.7-8.7" />
    <path d="m17 6 2.5 2.5" />
    <path d="m14.5 8.5 2 2" />
  </svg>
);
export const IconSpark = () => (
  <svg {...base}>
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
  </svg>
);
export const IconChevron = ({ dir }: { dir: "left" | "right" }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d={dir === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
  </svg>
);
export const IconClose = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
