export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 108 108" aria-hidden>
      <defs>
        <linearGradient id="lg-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2A1F5E" /><stop offset="1" stopColor="#120F22" /></linearGradient>
        <linearGradient id="lg-arc" x1="30" y1="54" x2="78" y2="54" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#9B86FF" /><stop offset="1" stopColor="#3DDCC5" /></linearGradient>
      </defs>
      <rect width="108" height="108" rx="26" fill="url(#lg-bg)" />
      <path d="M39.15 68.85A21 21 0 1 1 68.85 68.85" fill="none" stroke="url(#lg-arc)" strokeWidth="5.5" strokeLinecap="round" />
      <path d="M54 54L64.93 40.98" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" />
      <circle cx="54" cy="54" r="4.8" fill="#fff" />
    </svg>
  );
}

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <div className="flex items-center gap-3">
      <LogoMark size={size} />
      <span className="font-display text-xl font-semibold tracking-tight">ApexDriver</span>
    </div>
  );
}
