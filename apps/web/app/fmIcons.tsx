/**
 * Small outline icons shared by the FleetMind v2.0 screens (Home, Minhas Reservas, checklists). Decorative only
 * (aria-hidden); sized by the surrounding `.fm-theme` rules.
 */
function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const FmCarIcon = () => (
  <Svg>
    <path d="M3 17.5h1.2a2.3 2.3 0 0 0 4.4 0h6.8a2.3 2.3 0 0 0 4.4 0H21v-4l-2.5-4.5H15V7a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10.5Z" />
    <circle cx="6.6" cy="17.5" r="1.6" />
    <circle cx="16.4" cy="17.5" r="1.6" />
  </Svg>
);
export const FmUsersIcon = () => (
  <Svg>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 19c.4-3.2 2.8-5 6-5s5.6 1.8 6 5" />
    <circle cx="17" cy="9" r="2.4" />
    <path d="M17 14c2.3 0 3.7 1.4 4 4" />
  </Svg>
);
export const FmCalendarIcon = () => (
  <Svg>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Svg>
);
export const FmChevronIcon = () => (
  <Svg>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);
export const FmPinIcon = () => (
  <Svg>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
    <circle cx="12" cy="10" r="2.3" />
  </Svg>
);
export const FmGaugeIcon = () => (
  <Svg>
    <path d="M4 17a8 8 0 1 1 16 0" />
    <path d="m12 17 4-6" />
  </Svg>
);
export const FmFuelIcon = () => (
  <Svg>
    <path d="M6 20V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v15M5 20h10" />
    <path d="M14 9h2.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 0 3 0V8l-2.5-2.5" />
    <path d="M8 8h4" />
  </Svg>
);
export const FmBatteryIcon = () => (
  <Svg>
    <rect x="3" y="7.5" width="16" height="9" rx="2" />
    <path d="M21.5 11v2M8 12h6" />
  </Svg>
);
export const FmAlertIcon = () => (
  <Svg>
    <path d="M12 4 3 19.5h18L12 4Z" />
    <path d="M12 10v4.5M12 17.2v.1" />
  </Svg>
);
export const FmCheckIcon = () => (
  <Svg>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);
export const FmPlusIcon = () => (
  <Svg>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const FmArrowOutIcon = () => (
  <Svg>
    <path d="M10 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H10" />
    <path d="M10 12h10" />
    <path d="m16 8 4 4-4 4" />
  </Svg>
);
export const FmArrowInIcon = () => (
  <Svg>
    <path d="M14 4h3.5A1.5 1.5 0 0 1 19 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14" />
    <path d="M4 12h10" />
    <path d="m10 8 4 4-4 4" />
  </Svg>
);
export const FmSearchIcon = () => (
  <Svg>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Svg>
);
export const FmWrenchIcon = () => (
  <Svg>
    <path d="M20 5.5a5 5 0 0 1-6.6 6.6L5.9 19.6a2.2 2.2 0 0 1-3.1-3.1l7.5-7.5A5 5 0 0 1 16.9 2.4l-3 3 1.9 3.8 3.8 1.9 1-2.6" />
  </Svg>
);
export const FmRouteIcon = () => (
  <Svg>
    <circle cx="6" cy="18" r="2.2" />
    <circle cx="18" cy="6" r="2.2" />
    <path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8" />
  </Svg>
);
