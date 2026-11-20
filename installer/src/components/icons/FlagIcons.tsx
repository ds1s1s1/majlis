export function FlagIcon({ code }: { code: string }) {
  const w = 26;
  const h = 18;
  const renderStripes = () => {
    switch (code) {
      case 'ar':
        return (
          <>
            <rect width="26" height="18" fill="#006C35" />
            <rect x="6" y="7.5" width="14" height="1.5" rx="0.75" fill="#F2EFE9" />
            <rect x="8" y="11" width="10" height="1.2" rx="0.6" fill="#F2EFE9" opacity="0.85" />
          </>
        );
      case 'en':
        return (
          <>
            <rect width="26" height="18" fill="#012169" />
            <path d="M0 0 L26 18 M26 0 L0 18" stroke="#FFFFFF" strokeWidth="3.2" />
            <path d="M0 0 L26 18 M26 0 L0 18" stroke="#C8102E" strokeWidth="1.6" />
            <path d="M13 0 V18 M0 9 H26" stroke="#FFFFFF" strokeWidth="5" />
            <path d="M13 0 V18 M0 9 H26" stroke="#C8102E" strokeWidth="3" />
          </>
        );
      case 'de':
        return (
          <>
            <rect width="26" height="6" fill="#111111" />
            <rect y="6" width="26" height="6" fill="#DD0000" />
            <rect y="12" width="26" height="6" fill="#FFCE00" />
          </>
        );
      case 'es':
        return (
          <>
            <rect width="26" height="18" fill="#AA151B" />
            <rect y="4.5" width="26" height="9" fill="#F1BF00" />
          </>
        );
      case 'fr':
        return (
          <>
            <rect width="8.7" height="18" fill="#002395" />
            <rect x="8.7" width="8.6" height="18" fill="#FFFFFF" />
            <rect x="17.3" width="8.7" height="18" fill="#ED2939" />
          </>
        );
      case 'tr':
        return (
          <>
            <rect width="26" height="18" fill="#E30A17" />
            <circle cx="11" cy="9" r="4.5" fill="#FFFFFF" />
            <circle cx="12.3" cy="9" r="3.6" fill="#E30A17" />
            <circle cx="16" cy="9" r="1.4" fill="#FFFFFF" />
          </>
        );
      case 'id':
        return (
          <>
            <rect width="26" height="9" fill="#FF0000" />
            <rect y="9" width="26" height="9" fill="#FFFFFF" />
          </>
        );
      case 'it':
        return (
          <>
            <rect width="8.7" height="18" fill="#009246" />
            <rect x="8.7" width="8.6" height="18" fill="#FFFFFF" />
            <rect x="17.3" width="8.7" height="18" fill="#CE2B37" />
          </>
        );
      case 'pt-BR':
        return (
          <>
            <rect width="26" height="18" fill="#009C3B" />
            <polygon points="13,2 23,9 13,16 3,9" fill="#FFDF00" />
            <circle cx="13" cy="9" r="3.5" fill="#002776" />
          </>
        );
      case 'ru':
        return (
          <>
            <rect width="26" height="6" fill="#FFFFFF" />
            <rect y="6" width="26" height="6" fill="#0039A6" />
            <rect y="12" width="26" height="6" fill="#D52B1E" />
          </>
        );
      case 'ja':
        return (
          <>
            <rect width="26" height="18" fill="#FFFFFF" />
            <circle cx="13" cy="9" r="4.8" fill="#BC002D" />
          </>
        );
      case 'ko':
        return (
          <>
            <rect width="26" height="18" fill="#FFFFFF" />
            <circle cx="13" cy="9" r="4.5" fill="#CD2E3A" />
            <path d="M8.5 9 A4.5 4.5 0 0 0 17.5 9 Z" fill="#0047A0" />
          </>
        );
      case 'hi':
        return (
          <>
            <rect width="26" height="6" fill="#FF9933" />
            <rect y="6" width="26" height="6" fill="#FFFFFF" />
            <rect y="12" width="26" height="6" fill="#138808" />
            <circle cx="13" cy="9" r="2.1" stroke="#000080" strokeWidth="0.9" fill="none" />
          </>
        );
      case 'pl':
        return (
          <>
            <rect width="26" height="9" fill="#FFFFFF" />
            <rect y="9" width="26" height="9" fill="#DC143C" />
          </>
        );
      case 'vi':
        return (
          <>
            <rect width="26" height="18" fill="#DA251D" />
            <polygon points="13,4.2 14.3,8 18.2,8 15,10.2 16.2,14 13,11.7 9.8,14 11,10.2 7.8,8 11.7,8" fill="#FFFF00" />
          </>
        );
      default: // zh
        return (
          <>
            <rect width="26" height="18" fill="#DE2910" />
            <circle cx="6.5" cy="5.5" r="2" fill="#FFDE00" />
            <circle cx="10.2" cy="3.5" r="0.7" fill="#FFDE00" />
            <circle cx="11.2" cy="5.5" r="0.7" fill="#FFDE00" />
            <circle cx="10.2" cy="7.5" r="0.7" fill="#FFDE00" />
          </>
        );
    }
  };

  return (
    <svg width={w} height={h} viewBox="0 0 26 18" className="shrink-0 overflow-hidden rounded-[3px] ring-1 ring-white/15">
      {renderStripes()}
    </svg>
  );
}
