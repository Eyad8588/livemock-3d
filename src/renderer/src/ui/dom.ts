// Small DOM helpers shared by all UI components.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type AttrValue = string | number | boolean | undefined | ((e: any) => void)

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, AttrValue>,
  ...children: (Node | string | undefined | null)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === false) continue
      if (k === 'class') node.className = String(v)
      else if (typeof v === 'function' && k.startsWith('on')) {
        node.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
      }
      else if (typeof v === 'function') {
        v(undefined)
      } else if (v !== true) {
        node.setAttribute(k, String(v))
      } else {
        node.setAttribute(k, '')
      }
    }
  }
  for (const c of children) {
    if (c === undefined || c === null) continue
    node.append(c instanceof Node ? c : document.createTextNode(c))
  }
  return node
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild)
}
