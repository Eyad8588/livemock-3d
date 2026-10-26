// Toast notifications.
import { el } from './dom'

let host: HTMLElement | null = null

export function toast(message: string, ms = 2600): void {
  if (!host) {
    host = el('div', { id: 'toast-host' })
    document.body.appendChild(host)
  }
  const item = el('div', { class: 'toast' }, message)
  host.appendChild(item)
  window.setTimeout(() => {
    item.remove()
  }, ms)
}
