// Top bar: project actions, undo/redo, language/theme, export entry points.
import { store } from '../state/store'
import { t, setLang, getLang, onLangChange, type Lang } from '../i18n/i18n'
import { el, clear } from './dom'
import { toast } from './toast'
import { openExportDialog } from './dialogs'
import { openModesDialog } from './modesDialog'

export function mountTopbar(root: HTMLElement): void {
  const render = (): void => {
    clear(root)

    const logo = el('strong', {}, 'LiveMock 3D')
    const projectName = el('input', {
      type: 'text',
      value: store.project.name,
      style: 'width:200px',
      onchange: (e: Event) => {
        const v = (e.target as HTMLInputElement).value
        store.edit('Rename project', (p) => {
          p.name = v
        })
      }
    })

    const btn = (label: string, fn: () => void, cls = '', disabled = false): HTMLButtonElement =>
      el('button', { class: cls, onclick: fn, disabled }, label)

    const bar = el(
      'div',
      { class: 'row', style: 'margin:0; flex:1' },
      logo,
      projectName,
      el('span', { class: 'badge' }, '.livemock'),
      btn(t('top.new'), () => void newProject()),
      btn(t('top.open'), () => void openProject()),
      btn(t('top.save'), () => void saveProject()),
      btn(t('top.modes'), () => openModesDialog(), 'accent'),
      btn(t('top.undo'), () => {
        if (!store.undo()) toast('Nothing to undo')
      }, 'ghost'),
      btn(t('top.redo'), () => {
        if (!store.redo()) toast('Nothing to redo')
      }, 'ghost')
    )

    const langBtn = btn(getLang() === 'en' ? 'العربية' : 'English', () => {
      const next: Lang = getLang() === 'en' ? 'ar' : 'en'
      setLang(next)
      void window.livemock.settingsSet({ language: next })
    }, 'ghost')

    const themeBtn = btn(
      document.documentElement.dataset['theme'] === 'light' ? '🌙' : '☀️',
      () => {
        const next = document.documentElement.dataset['theme'] === 'light' ? 'dark' : 'light'
        document.documentElement.dataset['theme'] = next
        void window.livemock.settingsSet({ theme: next })
      },
      'ghost'
    )
    themeBtn.title = t('top.theme')

    const right = el(
      'div',
      { class: 'row', style: 'margin:0' },
      langBtn,
      themeBtn,
      btn(t('top.export'), () => void openExportDialog(), 'primary')
    )

    root.append(bar, right)
  }

  store.on('project', render)
  onLangChange(render)
  render()
}

async function newProject(): Promise<void> {
  const res = await window.livemock.newProject()
  const project = JSON.parse(res.projectJson) as import('@shared/types').Project
  store.loadProject(project, null)
}

async function openProject(): Promise<void> {
  const res = await window.livemock.openProjectDialog()
  if (!res.ok || !res.projectJson) {
    if (res.error) toast(res.error)
    return
  }
  store.loadProject(JSON.parse(res.projectJson) as import('@shared/types').Project, res.path ?? null)
  toast(t('toast.opened'))
}

async function saveProject(): Promise<void> {
  const json = JSON.stringify(store.project)
  if (store.filePath) {
    const res = await window.livemock.saveProjectToPath(store.filePath, json)
    if (res.ok) toast(t('toast.saved'))
    else if (res.error) toast(res.error)
    return
  }
  const res = await window.livemock.saveProjectDialog({ suggestedName: store.project.name, projectJson: json })
  if (res.ok && res.path) {
    store.filePath = res.path
    toast(t('toast.saved'))
  } else if (res.error) {
    toast(res.error)
  }
}
