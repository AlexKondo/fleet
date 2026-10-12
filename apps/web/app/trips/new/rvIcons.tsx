function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const RvCarIcon = () => (
  <Svg>
    <path d="M3 17.5h1.2a2.3 2.3 0 0 0 4.4 0h6.8a2.3 2.3 0 0 0 4.4 0H21v-4l-2.5-4.5H15V7a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10.5Z" />
    <circle cx="6.6" cy="17.5" r="1.6" />
    <circle cx="16.4" cy="17.5" r="1.6" />
  </Svg>
);
export const RvUsersIcon = () => (
  <Svg>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 19c.4-3.2 2.8-5 6-5s5.6 1.8 6 5" />
    <circle cx="17" cy="9" r="2.4" />
    <path d="M17 14c2.3 0 3.7 1.4 4 4" />
  </Svg>
);
export const RvCheckIcon = () => (
  <Svg>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);
