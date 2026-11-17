// Toast notifications.
import { el } from './dom'

let host: HTMLElement | null = null

export function toast(message: string, ms = 2600, onClick?: () => void): void {
  if (!host) {
    host = el('div', { id: 'toast-host' })
    document.body.appendChild(host)
  }
  const item = el('div', { class: 'toast' }, message)
  if (onClick) {
    item.style.cursor = 'pointer'
    item.style.pointerEvents = 'auto'
    item.addEventListener('click', onClick)
  }
  host.appendChild(item)
  window.setTimeout(() => {
    item.remove()
  }, ms)
}
