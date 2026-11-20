// 16 offline-safe inline SVG brand platform icons + URL builders for profile social chips
export type SocialPlatformId =
  | 'discord'
  | 'steam'
  | 'instagram'
  | 'tiktok'
  | 'letterboxd'
  | 'x'
  | 'youtube'
  | 'twitch'
  | 'github'
  | 'spotify'
  | 'reddit'
  | 'playstation'
  | 'xbox'
  | 'anilist'
  | 'trakt'
  | 'website';

export interface SocialPlatformMeta {
  id: SocialPlatformId;
  name: string;
  prefix: string;
  color: string;
  buildUrl: (handle: string) => string;
}

const cleanH = (h: string) => String(h || '').trim().replace(/^@+/, '');

export const SOCIAL_PLATFORMS: SocialPlatformMeta[] = [
  { id: 'discord', name: 'Discord', prefix: 'discord.com/users/', color: '#5865F2', buildUrl: (h) => `https://discord.com/users/${encodeURIComponent(cleanH(h))}` },
  { id: 'steam', name: 'Steam', prefix: 'steamcommunity.com/id/', color: '#1B2838', buildUrl: (h) => `https://steamcommunity.com/id/${encodeURIComponent(cleanH(h))}` },
  { id: 'instagram', name: 'Instagram', prefix: 'instagram.com/', color: '#E4405F', buildUrl: (h) => `https://instagram.com/${encodeURIComponent(cleanH(h))}` },
  { id: 'tiktok', name: 'TikTok', prefix: 'tiktok.com/@', color: '#FE2C55', buildUrl: (h) => `https://www.tiktok.com/@${encodeURIComponent(cleanH(h))}` },
  { id: 'letterboxd', name: 'Letterboxd', prefix: 'letterboxd.com/', color: '#00E054', buildUrl: (h) => `https://letterboxd.com/${encodeURIComponent(cleanH(h))}` },
  { id: 'x', name: 'X', prefix: 'x.com/', color: '#E7E9EA', buildUrl: (h) => `https://x.com/${encodeURIComponent(cleanH(h))}` },
  { id: 'youtube', name: 'YouTube', prefix: 'youtube.com/@', color: '#FF0000', buildUrl: (h) => `https://youtube.com/@${encodeURIComponent(cleanH(h))}` },
  { id: 'twitch', name: 'Twitch', prefix: 'twitch.tv/', color: '#9146FF', buildUrl: (h) => `https://twitch.tv/${encodeURIComponent(cleanH(h))}` },
  { id: 'github', name: 'GitHub', prefix: 'github.com/', color: '#E6EDF3', buildUrl: (h) => `https://github.com/${encodeURIComponent(cleanH(h))}` },
  { id: 'spotify', name: 'Spotify', prefix: 'open.spotify.com/user/', color: '#1DB954', buildUrl: (h) => `https://open.spotify.com/user/${encodeURIComponent(cleanH(h))}` },
  { id: 'reddit', name: 'Reddit', prefix: 'reddit.com/u/', color: '#FF4500', buildUrl: (h) => `https://reddit.com/user/${encodeURIComponent(cleanH(h))}` },
  { id: 'playstation', name: 'PlayStation', prefix: 'psnprofiles.com/', color: '#0070D1', buildUrl: (h) => `https://psnprofiles.com/${encodeURIComponent(cleanH(h))}` },
  { id: 'xbox', name: 'Xbox', prefix: 'account.xbox.com/profile?gamertag=', color: '#107C10', buildUrl: (h) => `https://account.xbox.com/en-us/profile?gamertag=${encodeURIComponent(cleanH(h))}` },
  { id: 'anilist', name: 'AniList', prefix: 'anilist.co/user/', color: '#02A9FF', buildUrl: (h) => `https://anilist.co/user/${encodeURIComponent(cleanH(h))}` },
  { id: 'trakt', name: 'Trakt', prefix: 'trakt.tv/users/', color: '#ED1C24', buildUrl: (h) => `https://trakt.tv/users/${encodeURIComponent(cleanH(h))}` },
  { id: 'website', name: 'Website', prefix: 'https://', color: '#E5A93C', buildUrl: (h) => (/^https?:\/\//i.test(h) ? h : `https://${cleanH(h)}`) },
];

export function SocialPlatformIcon({ id, size = 15, className = '' }: { id: SocialPlatformId; size?: number; className?: string }) {
  const s = { width: size, height: size };
  switch (id) {
    case 'discord':
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="currentColor"><path d="M19.3 5.4A15.8 15.8 0 0 0 15.3 4l-.2.4a14 14 0 0 1 3.4 1.3c-3-1.4-6.4-1.4-9.5 0 .1-.1 2.2-1 3.4-1.3L12.2 4a15.8 15.8 0 0 0-4 1.4C5.7 9.1 5 12.7 5.3 16.3a16 16 0 0 0 4.8 2.4l.7-1.1a9.8 9.8 0 0 1-1.6-.8l.4-.3a11 11 0 0 0 9.4 0l.4.3a9.8 9.8 0 0 1-1.6.8l.7 1.1a16 16 0 0 0 4.8-2.4c.4-4-.6-7.6-2-10.9ZM9.5 14.2c-.8 0-1.5-.8-1.5-1.7s.7-1.7 1.5-1.7 1.5.8 1.5 1.7-.7 1.7-1.5 1.7Zm5 0c-.8 0-1.5-.8-1.5-1.7s.7-1.7 1.5-1.7 1.5.8 1.5 1.7-.7 1.7-1.5 1.7Z" /></svg>;
    case 'steam':
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="currentColor"><path d="M12 2a10 10 0 0 0-9.9 8.6l5.4 2.2a2.9 2.9 0 0 1 1.7-.5h.1l2.4-3.5v-.1a3.8 3.8 0 1 1 3.8 3.8h-.1l-3.4 2.5a2.9 2.9 0 0 1-2.9 3 2.9 2.9 0 0 1-2.8-2l-3.8-1.6A10 10 0 1 0 12 2Zm3.5 4.4a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6Z" /></svg>;
    case 'instagram':
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" /></svg>;
    case 'tiktok':
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="currentColor"><path d="M15 3v9.5a3.5 3.5 0 1 1-2.8-3.4V6.8a6.2 6.2 0 1 0 5.3 6.1V8.3a7.2 7.2 0 0 0 4 1.3V6.9A4.4 4.4 0 0 1 17.6 3H15Z" /></svg>;
    case 'letterboxd':
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="currentColor"><circle cx="6" cy="12" r="4" opacity=".9" /><circle cx="12" cy="12" r="4" opacity=".7" /><circle cx="18" cy="12" r="4" opacity=".9" /></svg>;
    case 'x':
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="currentColor"><path d="M18.2 3h3l-6.6 7.5L22.4 21h-6.1l-4.8-6.3L6 21H3l7-8L2.6 3H9l4.3 5.8L18.2 3Zm-1.1 16h1.7L8.1 4.9H6.3L17.1 19Z" /></svg>;
    case 'youtube':
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="currentColor"><path d="M21.6 7.2a2.7 2.7 0 0 0-1.9-1.9C18 4.8 12 4.8 12 4.8s-6 0-7.7.5A2.7 2.7 0 0 0 2.4 7.2 28 28 0 0 0 2 12a28 28 0 0 0 .4 4.8 2.7 2.7 0 0 0 1.9 1.9c1.7.5 7.7.5 7.7.5s6 0 7.7-.5a2.7 2.7 0 0 0 1.9-1.9c.3-1.6.4-3.2.4-4.8s-.1-3.2-.4-4.8ZM10 15.2V8.8L15.6 12 10 15.2Z" /></svg>;
    case 'twitch':
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="currentColor"><path d="M4 3h17v11l-4 4h-4l-3 3H7v-3H4V3Zm15 10V5H6v10h3v3l3-3h4l3-3Zm-4-5v4h-2V8h2Zm-5 0v4H8V8h2Z" /></svg>;
    case 'github':
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="currentColor"><path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 3 .8a2.2 2.2 0 0 1 .7-1.4c-2.2-.3-4.6-1.1-4.6-5a3.9 3.9 0 0 1 1-2.7 3.6 3.6 0 0 1 .1-2.7s.8-.3 2.8 1a9.5 9.5 0 0 1 5 0c2-1.3 2.8-1 2.8-1a3.6 3.6 0 0 1 .1 2.7 3.9 3.9 0 0 1 1 2.7c0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10 10 0 0 0 12 2Z" /></svg>;
    case 'spotify':
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.6 14.4a.7.7 0 0 1-1 .2c-2.6-1.6-5.9-2-9.8-1a.7.7 0 1 1-.3-1.4c4.3-1 8-.6 10.9 1.2.3.2.4.7.2 1Zm1.2-2.7a.9.9 0 0 1-1.2.3c-3-1.8-7.5-2.4-11-1.3a.9.9 0 0 1-.5-1.7c4-1.2 9-.6 12.4 1.5.4.3.6.8.3 1.2Zm.1-2.8c-3.5-2.1-9.4-2.3-12.8-1.3a1 1 0 1 1-.6-2c3.9-1.2 10.4-1 14.4 1.4a1 1 0 0 1-1 1.9Z" /></svg>;
    case 'reddit':
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="currentColor"><path d="M21 12a2.2 2.2 0 0 0-3.7-1.6A9.8 9.8 0 0 0 12.8 9l.8-3.6 2.5.5a1.5 1.5 0 1 0 .2-1l-3.3-.7a.5.5 0 0 0-.6.4l-1 4.4A9.8 9.8 0 0 0 6.7 10.4 2.2 2.2 0 1 0 4.3 14a4 4 0 0 0 0 .8c0 3.2 3.5 5.8 7.7 5.8s7.7-2.6 7.7-5.8a4 4 0 0 0 0-.8A2.2 2.2 0 0 0 21 12ZM8.8 14a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Zm6.4 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Zm-6 2.5c1.6 1.2 4 1.2 5.6 0a.5.5 0 1 1 .6.8c-2 1.4-4.8 1.4-6.8 0a.5.5 0 1 1 .6-.8Z" /></svg>;
    case 'playstation':
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="currentColor"><path d="M10 4v15l3 1V8.5c0-.9.4-1.3 1.1-1 .7.3 1 .9 1 1.7V14c2.4 1 4.2-.2 4.2-2.9 0-2.8-1.4-4.3-4.6-5.4C12.8 5 11.1 4.4 10 4Zm-5.5 11.4c-2 .7-2.3 1.9-.9 2.7 1.3.8 3.6 1 5.4.4v-1.7l-1.5.5c-1 .3-1.8.2-1.5-.3.2-.4.9-.7 1.7-1l1.3-.4v-1.5l-4.5 1.3Zm10 .4-3 .9v1.7l4.6-1.5c1.7-.5 2.7-1.6 1.6-2.4-1-.7-2.7-.7-4.6-.1v1.4l1.4-.4c.9-.3 1.5 0 1 .4Z" /></svg>;
    case 'xbox':
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-4.9 3a8 8 0 0 1 9.8 0c-.8-.1-2.5.7-4.9 2.5C9.6 5.7 7.9 4.9 7.1 5ZM12 10.6c2.6 2 5.3 5 5.8 6.8a8 8 0 0 1-11.6 0c.5-1.8 3.2-4.8 5.8-6.8Z" /></svg>;
    case 'anilist':
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="currentColor"><path d="M8.4 4h2.8l5 16h-2.9l-.9-3H7.1l-.9 3H3.4l5-16Zm-.5 10.3h3.6L9.7 7.8l-1.8 6.5Zm7.6-10.3H20v2.6h-4.5V4Zm0 4.2H20V20h-4.5V8.2Z" /></svg>;
    case 'trakt':
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.8 7.5-5.6 5.6-3-3 1.4-1.4 1.6 1.6 4.2-4.2 1.4 1.4Z" /></svg>;
    default:
      return <svg viewBox="0 0 24 24" style={s} className={className} fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>;
  }
}
