import en from './en.json'
import ar from './ar.json'

export type Lang = 'en' | 'ar'

const dicts: Record<Lang, Record<string, string>> = { en, ar }

let current: Lang = 'en'
const listeners = new Set<() => void>()

export function setLang(lang: Lang): void {
  current = lang
  document.documentElement.lang = lang
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
  for (const l of listeners) l()
}

export function getLang(): Lang {
  return current
}

export function onLangChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let s = dicts[current][key] ?? dicts.en[key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v))
  }
  return s
}
