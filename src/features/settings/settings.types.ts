export type Language     = 'ar' | 'en'
export type Theme        = 'light' | 'dark' | 'auto'
export type TextSize     = 'small' | 'default' | 'large' | 'xlarge'
export type LuxuryTheme  = 'dark-luxury' | 'light-ivory' | 'deep-jewel' | 'sapphire'
// WAFI-062: minutes of inactivity before the app locks and requires PIN re-entry;
// 'never' disables auto-lock. Default 15.
export type IdleTimeout  = 5 | 15 | 30 | 60 | 'never'
