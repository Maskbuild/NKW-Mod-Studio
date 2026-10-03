/** Text in English and Thai. */
export interface L10n {
  en: string
  th: string
}

/** English + Thai text. */
export const t = (en: string, th: string): L10n => ({ en, th })
