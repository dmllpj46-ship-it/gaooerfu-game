import { CLUBS } from '../game/clubs'

export interface HudState {
  readonly holeNumber: number
  readonly holeCount: number
  readonly par: number
  readonly strokes: number
  readonly distanceM: number
  /** 风向在屏幕上的角度（度，0 = 正前方，顺时针为正） */
  readonly windDeg: number
  readonly windSpeedMps: number
  readonly lieLabel: string
  readonly clubIndex: number
}

/** 屏幕 HUD：洞况、力度条、杆种选择、事件提示（原生 DOM，无 UI 框架） */
export class Hud {
  private readonly root: HTMLDivElement
  private readonly holeLine: HTMLDivElement
  private readonly strokeLine: HTMLDivElement
  private readonly distanceLine: HTMLDivElement
  private readonly lieLine: HTMLDivElement
  private readonly powerFill: HTMLDivElement
  private readonly powerLabel: HTMLSpanElement
  private readonly windNeedle: SVGSVGElement
  private readonly windSpeed: HTMLDivElement
  private readonly clubButtons: HTMLButtonElement[] = []
  private readonly toastEl: HTMLDivElement
  private readonly hintEl: HTMLDivElement
  private readonly aimEl: HTMLDivElement
  private readonly aimValue: HTMLSpanElement
  private toastTimer = 0

  constructor(onClubSelect: (index: number) => void) {
    this.root = document.createElement('div')
    this.root.className = 'hud'
    this.root.innerHTML = `
      <div class="hud__panel">
        <div class="hud__hole"></div>
        <div class="hud__row hud__stroke"></div>
        <div class="hud__row hud__distance"></div>
        <div class="hud__row hud__lie"></div>
      </div>
      <div class="wind">
        <div class="wind__dial">
          <svg class="wind__needle" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3 L18.5 18 L12 14.6 L5.5 18 Z" fill="currentColor" />
          </svg>
        </div>
        <div class="wind__speed"><b>0.0</b> m/s</div>
      </div>
      <div class="aim aim--hidden">
        <span class="aim__label">瞄准</span>
        <span class="aim__value">正对球洞</span>
      </div>
      <div class="power">
        <div class="power__track"><div class="power__fill"></div></div>
        <span class="power__label">力度 0%</span>
      </div>
      <div class="hud__clubs"></div>
      <div class="toast"></div>
      <div class="hud__hint">左右拖动瞄准（不出杆）· 下拉蓄力、松手击球 · Shift / ←→ 微调 · 1–4 换杆</div>
    `
    document.body.appendChild(this.root)

    this.holeLine = this.root.querySelector('.hud__hole') as HTMLDivElement
    this.strokeLine = this.root.querySelector('.hud__stroke') as HTMLDivElement
    this.distanceLine = this.root.querySelector('.hud__distance') as HTMLDivElement
    this.lieLine = this.root.querySelector('.hud__lie') as HTMLDivElement
    this.powerFill = this.root.querySelector('.power__fill') as HTMLDivElement
    this.powerLabel = this.root.querySelector('.power__label') as HTMLSpanElement
    this.windNeedle = this.root.querySelector('.wind__needle') as SVGSVGElement
    this.windSpeed = this.root.querySelector('.wind__speed') as HTMLDivElement
    this.toastEl = this.root.querySelector('.toast') as HTMLDivElement
    this.hintEl = this.root.querySelector('.hud__hint') as HTMLDivElement
    this.aimEl = this.root.querySelector('.aim') as HTMLDivElement
    this.aimValue = this.root.querySelector('.aim__value') as HTMLSpanElement

    const clubBar = this.root.querySelector('.hud__clubs') as HTMLDivElement
    CLUBS.forEach((club, index) => {
      const button = document.createElement('button')
      button.className = 'club'
      button.type = 'button'
      // 右上角的数字是键盘快捷键，和 Input.ts 的 '1'–'4' 一一对应
      button.innerHTML = `<i class="club__key">${index + 1}</i><b>${club.shortName}</b><span>${club.name}</span>`
      button.addEventListener('click', () => onClubSelect(index))
      clubBar.appendChild(button)
      this.clubButtons.push(button)
    })
  }

  update(state: HudState): void {
    this.holeLine.innerHTML = `第 ${state.holeNumber} 洞 <span>/ ${state.holeCount}</span>`
    this.strokeLine.textContent = `标准杆 ${state.par} · 已打 ${state.strokes} 杆`
    this.distanceLine.innerHTML = `剩余 <b>${Math.round(state.distanceM)}</b> m`
    this.lieLine.textContent = `球位：${state.lieLabel}`

    // 箭头指向风去的方向，角度已经换算成相对屏幕的朝向
    this.windNeedle.style.transform = `rotate(${state.windDeg.toFixed(1)}deg)`
    this.windSpeed.innerHTML = `<b>${state.windSpeedMps.toFixed(1)}</b> m/s`

    this.clubButtons.forEach((button, index) => {
      button.classList.toggle('club--active', index === state.clubIndex)
    })
  }

  /**
   * 只更新罗盘指针。相机会在机位之间缓慢过渡，角度必须每帧跟，
   * 否则箭头停在切换瞬间的朝向，指的方向是错的。
   */
  setWindDeg(deg: number): void {
    this.windNeedle.style.transform = `rotate(${deg.toFixed(1)}deg)`
  }

  setPower(power: number, visible: boolean): void {
    this.root.classList.toggle('hud--aiming', visible)
    const percent = Math.round(power * 100)
    this.powerFill.style.height = `${percent}%`
    this.powerFill.classList.toggle('power__fill--strong', power > 0.85)
    this.powerLabel.textContent = `力度 ${percent}%`
  }

  /**
   * 瞄准读数：相对"球→洞"方向偏了多少度（正 = 屏幕右侧）。
   * 玩家看不见球飞出去的方向，只能靠这条读数确认自己到底有没有对正，
   * 否则"鼠标难瞄准"根本没法自查——拖完了也不知道偏没偏。
   */
  setAim(deg: number, visible = true): void {
    this.aimEl.classList.toggle('aim--hidden', !visible)
    if (!visible) return

    const magnitude = Math.abs(deg)
    // 0.3° 以内当成对正：再往下抠精度没有意义，读数还会一直跳
    const off = magnitude >= 0.3
    this.aimEl.classList.toggle('aim--off', off)
    this.aimValue.textContent = off
      ? `${deg > 0 ? '偏右' : '偏左'} ${magnitude.toFixed(1)}°`
      : '正对球洞'
  }

  /** 玩家打出第一杆后收起教程提示：它常驻在画面正下方，会一直压着落点区域 */
  dismissHint(): void {
    this.hintEl.classList.add('hud__hint--gone')
  }

  toast(text: string, tone: 'good' | 'bad' | 'info' = 'info'): void {
    this.toastEl.textContent = text
    this.toastEl.className = `toast toast--show toast--${tone}`
    window.clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.className = 'toast'
    }, 2200)
  }

  dispose(): void {
    window.clearTimeout(this.toastTimer)
    this.root.remove()
  }
}
