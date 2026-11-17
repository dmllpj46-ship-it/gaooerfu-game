/**
 * 挥杆时序（PLAN.md §4.3）。
 * 关键约束：一次挥杆只允许触发一次 impact —— 这里用 `impactFired` 兜住（AGENTS.md 不变量 3）。
 */

export interface SwingPose {
  /** 躯干绕 Y 轴扭转（弧度，负值=向右后方上杆） */
  readonly torsoY: number
  /** 手臂绕 X 轴摆动 */
  readonly armsX: number
  /** 身体前倾 */
  readonly lean: number
  /**
   * 手腕铰链（弧度，绕 X）。球杆和手臂是刚性连接的，没有这一项时
   * 上杆顶点杆身会横着扫出去 —— 因为手臂转了 1.72 rad，杆子也跟着转了 1.72 rad，
   * 从"朝下"直接变成"朝后水平"。真实挥杆里手腕会把杆头折上去。
   */
  readonly wrist: number
}

/**
 * 手臂绕肩 pivot 的 X 轴旋转：0 = 自然下垂，正值 = 向后上杆，负值 = 向前。
 * 原先 address 给的是 0.62（手臂向后 35°），恰好抵消了球杆自身的前倾，
 * 结果杆身垂直插在两腿之间 —— 看起来像拄着拐杖而不是在瞄球。
 *
 * 这里取 0 而不是负数：手臂的前伸交给手臂网格自己的朝向，
 * pivot 保持不转，握把的世界坐标才等于它在 pivot 里的本地坐标 ——
 * 否则每调一次 pivot 角度，杆头位置就要重算一遍。
 */
export const ADDRESS_POSE: SwingPose = { torsoY: -0.22, armsX: 0, lean: 0.06, wrist: 0 }
// wrist 1.0 让杆身在顶点指向上方而不是横着扫出去
const TOP_POSE: SwingPose = { torsoY: -1.12, armsX: 1.72, lean: -0.02, wrist: 1.0 }
// 触球瞬间手要回到球的位置、手腕也要回正，杆头才落在球上。
// torsoY 只给 0.06：躯干扭转会把整条手臂+杆身绕身体 Y 轴转出去，
// 给到 0.14 时杆头会偏离球 0.18m，看起来像在球前面空挥。
const IMPACT_POSE: SwingPose = { torsoY: 0.06, armsX: 0, lean: 0.12, wrist: 0 }
const FOLLOW_POSE: SwingPose = { torsoY: 0.86, armsX: -0.9, lean: -0.04, wrist: 0.55 }

const DOWN_SWING_S = 0.13
const FOLLOW_S = 0.42

function lerpPose(a: SwingPose, b: SwingPose, t: number): SwingPose {
  return {
    torsoY: a.torsoY + (b.torsoY - a.torsoY) * t,
    armsX: a.armsX + (b.armsX - a.armsX) * t,
    lean: a.lean + (b.lean - a.lean) * t,
    wrist: a.wrist + (b.wrist - a.wrist) * t,
  }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

export class SwingAnimator {
  private active = false
  private elapsed = 0
  private backSwingS = 0.5
  private impactFired = false
  private onImpact: (() => void) | null = null
  private current: SwingPose = ADDRESS_POSE

  begin(power: number, onImpact: () => void): void {
    this.active = true
    this.elapsed = 0
    this.impactFired = false
    this.onImpact = onImpact
    // 力度越大回杆越慢、挥杆越完整
    this.backSwingS = 0.34 + 0.34 * Math.min(1, Math.max(0, power))
    this.current = ADDRESS_POSE
  }

  update(dt: number): void {
    if (!this.active) return
    this.elapsed += dt

    const backEnd = this.backSwingS
    const downEnd = backEnd + DOWN_SWING_S
    const followEnd = downEnd + FOLLOW_S

    if (this.elapsed <= backEnd) {
      this.current = lerpPose(ADDRESS_POSE, TOP_POSE, easeInOut(this.elapsed / backEnd))
    } else if (this.elapsed <= downEnd) {
      const t = (this.elapsed - backEnd) / DOWN_SWING_S
      this.current = lerpPose(TOP_POSE, IMPACT_POSE, t * t)
    } else if (this.elapsed <= followEnd) {
      const t = (this.elapsed - downEnd) / FOLLOW_S
      this.current = lerpPose(IMPACT_POSE, FOLLOW_POSE, easeOut(t))
    } else {
      this.current = lerpPose(FOLLOW_POSE, ADDRESS_POSE, easeInOut(Math.min(1, (this.elapsed - followEnd) / 0.5)))
      if (this.elapsed > followEnd + 0.5) this.active = false
    }

    // 只在触球瞬间放球，且只放一次
    if (!this.impactFired && this.elapsed >= downEnd) {
      this.impactFired = true
      const callback = this.onImpact
      this.onImpact = null
      callback?.()
    }
  }

  get isActive(): boolean {
    return this.active
  }

  get pose(): SwingPose {
    return this.current
  }
}
