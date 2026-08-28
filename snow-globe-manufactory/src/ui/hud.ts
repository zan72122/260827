import { icon } from './icons'
import type { GlobeRecipe, PieceKind, Settings } from '../core/state'

/**
 * DOM overlay. Everything is a large pictogram target; the canvas underneath
 * keeps its own gestures, so the HUD only claims the space it draws on.
 */

export interface TrayItem {
  id: string
  icon: string
  label?: string
  disabled?: boolean
  selected?: boolean
}

const PIECE_TINT: Record<PieceKind, string> = {
  house: '#d9a05f',
  fir: '#5f9e73',
  lamp: '#e8c37a',
  bridge: '#c08b5c',
  snowman: '#dfe8f2',
  deer: '#a67d52',
  centerTree: '#4f9068',
}

export class Hud {
  private steps = document.getElementById('steps') as HTMLDivElement
  private coach = document.getElementById('coach') as HTMLDivElement
  private tray = document.getElementById('tray') as HTMLDivElement
  private btnSettings = document.getElementById('btn-settings') as HTMLDivElement
  private sheet = document.getElementById('sheet') as HTMLDivElement
  private sheetRows = document.getElementById('sheet-rows') as HTMLDivElement
  private shelf = document.getElementById('shelf') as HTMLDivElement
  private shelfSlots = document.getElementById('shelf-slots') as HTMLDivElement
  private veil = document.getElementById('veil') as HTMLDivElement
  private veilGo = document.getElementById('veil-go') as HTMLDivElement

  private coachTimer = 0

  constructor(private onSettingsChange: (patch: Partial<Settings>) => void) {
    this.veilGo.innerHTML = icon('newGlobe')
    this.btnSettings.innerHTML = icon('gear')
    this.btnSettings.addEventListener('click', () => this.sheet.classList.add('open'))
    this.sheet.addEventListener('click', (e) => {
      if (e.target === this.sheet) this.sheet.classList.remove('open')
    })
    this.shelf.addEventListener('click', (e) => {
      if (e.target === this.shelf) this.shelf.classList.remove('open')
    })
  }

  onStart(fn: () => void) {
    let started = false
    const go = () => {
      if (started) return
      started = true
      this.veil.classList.add('gone')
      fn()
    }
    this.veilGo.addEventListener('click', go, { once: true })
    this.veil.addEventListener('pointerdown', (e) => {
      if (e.target === this.veil || (e.target as HTMLElement).tagName === 'H1') go()
    })
  }

  // --- step dots ---------------------------------------------------------

  setSteps(total: number, index: number) {
    if (this.steps.childElementCount !== total) {
      this.steps.innerHTML = ''
      for (let i = 0; i < total; i++) {
        const d = document.createElement('div')
        d.className = 'dot'
        this.steps.appendChild(d)
      }
    }
    ;[...this.steps.children].forEach((c, i) => {
      c.className = 'dot' + (i < index ? ' done' : i === index ? ' now' : '')
    })
  }

  setStepsVisible(v: boolean) {
    this.steps.style.display = v ? 'flex' : 'none'
  }

  // --- coach -------------------------------------------------------------

  setCoach(iconName: string | null, text: string) {
    window.clearTimeout(this.coachTimer)
    if (!iconName) {
      this.coach.classList.remove('show')
      return
    }
    this.coach.innerHTML = `${icon(iconName)}<div class="txt">${text}</div>`
    this.coach.classList.add('show')
  }

  hideCoachAfter(ms: number) {
    window.clearTimeout(this.coachTimer)
    this.coachTimer = window.setTimeout(() => this.coach.classList.remove('show'), ms)
  }

  // --- tray --------------------------------------------------------------

  setTray(items: TrayItem[], onPick: (id: string) => void) {
    this.tray.innerHTML = ''
    for (const it of items) {
      const b = document.createElement('div')
      b.className = 'btn' + (it.selected ? ' sel' : '')
      if (it.disabled) b.dataset.disabled = '1'
      const tint = PIECE_TINT[it.icon as PieceKind]
      b.innerHTML = `${icon(it.icon)}${it.label ? `<div class="lb">${it.label}</div>` : ''}`
      if (tint) (b.firstElementChild as SVGElement).style.color = tint
      b.addEventListener('click', () => {
        if (b.dataset.disabled === '1') return
        onPick(it.id)
      })
      this.tray.appendChild(b)
    }
  }

  clearTray() {
    this.tray.innerHTML = ''
  }

  // --- settings ----------------------------------------------------------

  buildSettings(s: Settings, motionAvailable: boolean) {
    const rows: Array<[keyof Settings, string]> = [
      ['sound', 'おと'],
      ['calmCamera', 'カメラを ゆっくり'],
      ['steadyLight', 'ひかりを おだやかに'],
    ]
    if (motionAvailable) rows.push(['motionShake', 'ふって うごかす'])
    this.sheetRows.innerHTML = ''
    for (const [key, label] of rows) {
      const row = document.createElement('div')
      row.className = 'row'
      row.dataset.on = s[key] ? '1' : '0'
      row.innerHTML = `<span>${label}</span><span class="sw"></span>`
      row.addEventListener('click', () => {
        const next = row.dataset.on !== '1'
        row.dataset.on = next ? '1' : '0'
        this.onSettingsChange({ [key]: next } as Partial<Settings>)
      })
      this.sheetRows.appendChild(row)
    }
    const close = document.createElement('div')
    close.className = 'row'
    close.innerHTML = `<span>とじる</span>${icon('close')}`
    close.querySelector('svg')!.setAttribute('width', '22')
    close.querySelector('svg')!.setAttribute('height', '22')
    close.addEventListener('click', () => this.sheet.classList.remove('open'))
    this.sheetRows.appendChild(close)
  }

  // --- saved globes ------------------------------------------------------

  openShelf(globes: GlobeRecipe[], onPick: (r: GlobeRecipe) => void, slots = 3) {
    this.shelfSlots.innerHTML = ''
    for (let i = 0; i < slots; i++) {
      const g = globes[i]
      const el = document.createElement('div')
      el.className = 'slot' + (g ? '' : ' empty')
      const cv = document.createElement('canvas')
      cv.width = cv.height = 192
      drawThumb(cv, g)
      el.appendChild(cv)
      const lb = document.createElement('div')
      lb.className = 'lb'
      lb.textContent = g ? `${i + 1}こめ` : 'あき'
      el.appendChild(lb)
      if (g) {
        el.addEventListener('click', () => {
          this.shelf.classList.remove('open')
          onPick(g)
        })
      }
      this.shelfSlots.appendChild(el)
    }
    this.shelf.classList.add('open')
  }

}

/** A flat drawing of a saved globe — no render targets, no stored images. */
function drawThumb(cv: HTMLCanvasElement, g?: GlobeRecipe) {
  const ctx = cv.getContext('2d')!
  const w = cv.width
  const h = cv.height
  ctx.clearRect(0, 0, w, h)

  const cx = w / 2
  const cy = h * 0.44
  const r = w * 0.34

  const sky = ctx.createLinearGradient(0, cy - r, 0, cy + r)
  sky.addColorStop(0, '#7d94a5')
  sky.addColorStop(1, '#41525f')
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = sky
  ctx.fill()

  if (g) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.97, 0, Math.PI * 2)
    ctx.clip()

    ctx.fillStyle = '#e7eef5'
    ctx.beginPath()
    ctx.ellipse(cx, cy + r * 0.72, r * 1.05, r * 0.42, 0, 0, Math.PI * 2)
    ctx.fill()

    const sorted = [...g.pieces].sort((a, b) => a.z - b.z)
    for (const p of sorted) {
      const px = cx + (p.x / 0.3) * r * 0.66
      const py = cy + r * 0.5 - (p.z / 0.3) * r * 0.13
      const s = r * 0.26
      ctx.fillStyle = PIECE_TINT[p.kind]
      ctx.strokeStyle = 'rgba(20,24,30,0.5)'
      ctx.lineWidth = 2
      ctx.beginPath()
      if (p.kind === 'fir' || p.kind === 'centerTree') {
        const hh = p.kind === 'centerTree' ? s * 1.5 : s
        ctx.moveTo(px, py - hh)
        ctx.lineTo(px - s * 0.45, py)
        ctx.lineTo(px + s * 0.45, py)
      } else if (p.kind === 'lamp') {
        ctx.rect(px - s * 0.1, py - s, s * 0.2, s)
        ctx.rect(px - s * 0.22, py - s * 1.3, s * 0.44, s * 0.36)
      } else if (p.kind === 'bridge') {
        ctx.moveTo(px - s * 0.8, py)
        ctx.quadraticCurveTo(px, py - s * 0.8, px + s * 0.8, py)
      } else {
        ctx.moveTo(px - s * 0.55, py)
        ctx.lineTo(px - s * 0.55, py - s * 0.55)
        ctx.lineTo(px, py - s)
        ctx.lineTo(px + s * 0.55, py - s * 0.55)
        ctx.lineTo(px + s * 0.55, py)
      }
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }

    const flakes = 10 + Math.round(g.snow * 26)
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    for (let i = 0; i < flakes; i++) {
      const a = (i * 2.399) % (Math.PI * 2)
      const rr = ((i * 0.618) % 1) * r * 0.92
      ctx.beginPath()
      ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.9, 1.6 + (i % 3), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  ctx.strokeStyle = 'rgba(215,235,248,0.5)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()

  ctx.fillStyle = g?.pedestal === 'brass' ? '#b98d43' : g?.pedestal === 'ceramic' ? '#d9d0c1' : '#7c5334'
  ctx.beginPath()
  ctx.moveTo(cx - r * 0.72, cy + r * 0.86)
  ctx.lineTo(cx + r * 0.72, cy + r * 0.86)
  ctx.lineTo(cx + r * 0.86, h * 0.94)
  ctx.lineTo(cx - r * 0.86, h * 0.94)
  ctx.closePath()
  ctx.fill()

  if (!g) {
    ctx.fillStyle = 'rgba(240,235,224,0.35)'
    ctx.font = `${Math.round(w * 0.3)}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('+', cx, cy)
  }
}
