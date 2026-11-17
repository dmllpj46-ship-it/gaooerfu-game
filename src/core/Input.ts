/**
 * 拖拽挥杆输入（PLAN.md §2.3）：
 * 向下拖 = 蓄力，左右拖 = 调整方向，松手击球。
 * 指针事件同时覆盖鼠标与触摸，不做两套逻辑。
 */

export interface InputHandlers {
  /** 当前基准瞄准角（球→洞，弧度） */
  baseAim(): number
  /** 现在是否允许调整瞄准 */
  canAim(): boolean
  onAim(power: number, aimRad: number): void
  onSwing(power: number, aimRad: number): void
  /** 只调整了方向、没有蓄力：保留新瞄准角，不出杆 */
  onAimEnd(aimRad: number): void
  onCancel(): void
  onClub(index: number): void
  /** 方向键微调瞄准（弧度，正 = 向右） */
  onNudgeAim(deltaRad: number): void
  /** Enter / 空格：触发遮罩上的主按钮 */
  onConfirm(): void
  onPauseToggle(): void
}

const MAX_POWER_PULL_PX = 240
/**
 * 瞄准灵敏度（弧度/像素）。0.0028 → 0.16°/px：
 * 1283px 的窗口横穿一次约 205°，够用；再灵敏就没法停在 1° 以内。
 */
const AIM_RAD_PER_PX = 0.0028
/**
 * 水平死区。向下拉 240px 蓄力时，手腕几乎必然左右漂 3–8px，
 * 没有死区的话准星会跟着一起跑，这是"鼠标很难瞄准"的第二个来源。
 */
const AIM_DEAD_ZONE_PX = 10
/** 按住 Shift 时的精细瞄准倍率 */
const AIM_FINE_SCALE = 0.25
/** 方向键单次微调（弧度，≈0.4°） */
const AIM_NUDGE_RAD = 0.007
/**
 * 下拉超过这个距离才算"开始蓄力"。
 * 低于它整段手势当作纯瞄准：松手不出杆，只是把方向定下来。
 * 否则每次用鼠标找方向都等于打一杆，根本没机会微调——
 * 这是"鼠标难瞄准"最根本的一条。
 */
const CHARGE_LOCK_PX = 30

/**
 * 水平位移 → 角度偏移。死区内返回 0，之后 1:1 线性。
 * 用"超出死区的部分"而不是"整段位移"起算，越过死区时才不会跳一下。
 */
function aimOffset(dx: number, fine: boolean): number {
  const excess = Math.abs(dx) - AIM_DEAD_ZONE_PX
  if (excess <= 0) return 0
  const scale = fine ? AIM_FINE_SCALE : 1
  return Math.sign(dx) * excess * AIM_RAD_PER_PX * scale
}

export class Input {
  private readonly handlers: InputHandlers
  private readonly element: HTMLElement
  private activePointer: number | null = null
  private startX = 0
  private startY = 0
  /**
   * 按下瞬间的瞄准角，整个拖拽过程都用它做基准。
   * 绝不能每次 move 都去问 handlers.baseAim() —— 那个值会被 onAim 改写，
   * 于是每帧都把"总位移"重新叠一遍，瞄准随拖动距离二次放大
   * （实测拖到 50px 时偏转 30°，是标称值的 3 倍，越拖越飞）。
   */
  private baseAimRad = 0
  private power = 0
  private aimRad = 0
  /** 本次手势是否已经进入蓄力；一旦锁定就不再退回纯瞄准 */
  private charging = false
  private lastDx = 0

  constructor(element: HTMLElement, handlers: InputHandlers) {
    this.element = element
    this.handlers = handlers

    element.addEventListener('pointerdown', this.onPointerDown)
    element.addEventListener('pointermove', this.onPointerMove)
    element.addEventListener('pointerup', this.onPointerUp)
    element.addEventListener('pointercancel', this.onPointerCancel)
    window.addEventListener('keydown', this.onKeyDown)
  }

  dispose(): void {
    this.element.removeEventListener('pointerdown', this.onPointerDown)
    this.element.removeEventListener('pointermove', this.onPointerMove)
    this.element.removeEventListener('pointerup', this.onPointerUp)
    this.element.removeEventListener('pointercancel', this.onPointerCancel)
    window.removeEventListener('keydown', this.onKeyDown)
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.activePointer !== null) return
    if (!this.handlers.canAim()) return

    this.activePointer = event.pointerId
    this.startX = event.clientX
    this.startY = event.clientY
    this.baseAimRad = this.handlers.baseAim()
    this.power = 0
    this.aimRad = this.baseAimRad
    this.charging = false
    this.lastDx = 0
    this.element.setPointerCapture?.(event.pointerId)
    this.handlers.onAim(this.power, this.aimRad)
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointer) return

    const dx = event.clientX - this.startX
    const dy = event.clientY - this.startY
    this.lastDx = dx

    // 下拉过线才进入蓄力，之后就算手滑往上抬也不退回纯瞄准，
    // 否则力度条会在 0 附近来回闪
    if (dy > CHARGE_LOCK_PX) this.charging = true
    this.power = this.charging ? Math.min(1, Math.max(0, dy / MAX_POWER_PULL_PX)) : 0

    this.aimRad = this.baseAimRad + aimOffset(dx, event.shiftKey)
    this.handlers.onAim(this.power, this.aimRad)
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointer) return
    this.activePointer = null
    this.element.releasePointerCapture?.(event.pointerId)

    if (!this.charging) {
      // 纯瞄准手势：方向变了就留着，只是原地按了一下就复位到"球→洞"
      if (Math.abs(this.lastDx) > AIM_DEAD_ZONE_PX) {
        this.handlers.onAimEnd(this.aimRad)
      } else {
        this.handlers.onCancel()
      }
      return
    }
    this.handlers.onSwing(this.power, this.aimRad)
  }

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointer) return
    this.activePointer = null
    this.handlers.onCancel()
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // 方向键允许按住连发（event.repeat 为 true），它是微调的主要方式
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (!this.handlers.canAim()) return
      event.preventDefault()
      this.handlers.onNudgeAim(event.key === 'ArrowLeft' ? -AIM_NUDGE_RAD : AIM_NUDGE_RAD)
      return
    }

    if (event.repeat) return

    const clubKeys: Record<string, number> = { '1': 0, '2': 1, '3': 2, '4': 3 }
    const clubIndex = clubKeys[event.key]
    if (clubIndex !== undefined) {
      this.handlers.onClub(clubIndex)
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      this.handlers.onConfirm()
      return
    }

    if (event.key === 'Escape' || event.key === 'p' || event.key === 'P') {
      this.handlers.onPauseToggle()
    }
  }
}
