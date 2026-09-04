function Svg({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function DashboardIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13" y="3.5" width="7.5" height="4.5" rx="1.5" />
      <rect x="13" y="10.5" width="7.5" height="10" rx="1.5" />
      <rect x="3.5" y="13.5" width="7.5" height="7" rx="1.5" />
    </Svg>
  );
}

export function TripsIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M3 17.5h1.2a2.3 2.3 0 0 0 4.4 0h6.8a2.3 2.3 0 0 0 4.4 0H21v-4l-2.5-4.5H15V7a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10.5Z" />
      <circle cx="6.6" cy="17.5" r="1.6" />
      <circle cx="16.4" cy="17.5" r="1.6" />
      <path d="M15 9h3.5l1.7 3H15V9Z" />
    </Svg>
  );
}

export function AnalyticsIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M3 20h18" />
    </Svg>
  );
}

export function FleetIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M3 16V9.5a1 1 0 0 1 1-1h9l4 3.5h2a1 1 0 0 1 1 1V16" />
      <path d="M3 16h1.2a2.3 2.3 0 0 0 4.4 0h6.8a2.3 2.3 0 0 0 4.4 0H21" />
      <circle cx="6.6" cy="16" r="1.6" />
      <circle cx="16.4" cy="16" r="1.6" />
      <path d="M13 8.5V13" />
    </Svg>
  );
}

export function TeamIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19.5c0-3 2.5-5.2 5.5-5.2s5.5 2.2 5.5 5.2" />
      <circle cx="17" cy="8.5" r="2.4" />
      <path d="M15.5 14.6c2.4.2 4.2 2.2 4.4 4.9" />
    </Svg>
  );
}

export function SettingsIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V19.5a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H4.5a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H10.5a1.7 1.7 0 0 0 1-1.6V4.5a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V10.6a1.7 1.7 0 0 0 1.6 1H19.5a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1Z" />
    </Svg>
  );
}

export function LogoutIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </Svg>
  );
}
