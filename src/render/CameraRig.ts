import * as THREE from 'three'

export type CameraMode = 'title' | 'address' | 'flight' | 'landing' | 'putt' | 'hole'

export interface RigContext {
  readonly ballPos: THREE.Vector3
  readonly ballVel: THREE.Vector3
  readonly aimRad: number
  readonly cupPos: THREE.Vector3
  readonly golferPos: THREE.Vector3
  /** 地形高度采样：用来防止相机钻到坡下面 */
  groundAt(x: number, z: number): number
}

const UP = new THREE.Vector3(0, 1, 0)

/**
 * 6 态机位（PLAN.md §4.5），全部靠阻尼插值切换，禁止瞬切。
 * 目标机位由"球 - 前进方向"推导，所以朝向任何方向的球洞都成立。
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera
  private mode: CameraMode = 'title'
  private time = 0

  private readonly smoothPosition = new THREE.Vector3(0, 2, -6)
  private readonly smoothTarget = new THREE.Vector3()
  private readonly desiredPosition = new THREE.Vector3()
  private readonly desiredTarget = new THREE.Vector3()
  private readonly forward = new THREE.Vector3()
  private readonly right = new THREE.Vector3()
  private initialized = false

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(48, aspect, 0.05, 2600)
  }

  setMode(mode: CameraMode): void {
    this.mode = mode
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  update(dt: number, ctx: RigContext): void {
    this.time += dt

    this.forward.set(Math.sin(ctx.aimRad), 0, Math.cos(ctx.aimRad))
    this.right.crossVectors(UP, this.forward)

    const ball = ctx.ballPos
    let lambda = 6

    switch (this.mode) {
      case 'title': {
        const angle = this.time * 0.22
        this.desiredPosition.set(
          ctx.golferPos.x + Math.sin(angle) * 4.4,
          ctx.golferPos.y + 2.1,
          ctx.golferPos.z + Math.cos(angle) * 4.4,
        )
        this.desiredTarget.copy(ctx.golferPos).addScaledVector(UP, 1.15)
        lambda = 2.5
        break
      }
      case 'address': {
        // 俯角必须算清楚：球在画面上的高度 ≈ 50% + (俯角 - 球相对机位的俯角) / 半垂直视角。
        // 4.6m / 1.35m 让球落在 78% 高度，刚好在底部球杆栏（91% 起）之上。
        // 原来的 4.0m / 1.6m 把球压到 86%，正好被球杆栏盖住 —— 看不见自己要打的球。
        this.desiredPosition
          .copy(ball)
          .addScaledVector(this.forward, -4.6)
          .addScaledVector(this.right, 0.55)
          .addScaledVector(UP, 1.35)
        this.desiredTarget.copy(ball).addScaledVector(this.forward, 18).addScaledVector(UP, 0.25)
        lambda = 5
        break
      }
      case 'putt': {
        // 原来 1.9m / 0.78m 太近：角色占掉右半屏、球被挤到画面最底部，
        // 而且球正好落在底部球杆栏后面看不见。这里退到 4.2m，
        // 俯角 ≈ 16° - 4° = 12°，球落在 76% 高度，同时看得见洞和整条推击线。
        this.desiredPosition
          .copy(ball)
          .addScaledVector(this.forward, -4.2)
          .addScaledVector(this.right, 0.55)
          .addScaledVector(UP, 1.25)
        this.desiredTarget.copy(ctx.cupPos).addScaledVector(UP, 0.15)
        lambda = 5
        break
      }
      case 'flight': {
        const speed = Math.hypot(ctx.ballVel.x, ctx.ballVel.z)
        if (speed > 1.5) this.forward.set(ctx.ballVel.x / speed, 0, ctx.ballVel.z / speed)
        // 速度越快镜头越滞后，让球"冲"出画面一点
        const lag = 5.5 + Math.min(4.5, speed * 0.08)
        // 只比球高 1.5m。原来 1.9+speed*0.03（最高 4.9m）配 6m 滞后，
        // 俯角到 31°，而半垂直视角只有 24° —— 地平线被整个推出画面，
        // 整段飞行只能看见草地，完全判断不了球往哪飞。
        const rise = 1.5
        this.desiredPosition
          .copy(ball)
          .addScaledVector(this.forward, -lag)
          .addScaledVector(UP, rise)
        // 看向球前方 14m、比球低 1.1m：俯角 ≈ 6–7°，球留在画面中央偏下，
        // 地平线落在上三分之一，天空、落点和球能同时看见。
        this.desiredTarget
          .copy(ball)
          .addScaledVector(this.forward, 14)
          .addScaledVector(UP, -1.1)
        lambda = 7
        break
      }
      case 'landing': {
        // 同样别俯视：5.5m 后 + 2.6m 高，看向球前 5m 略低于球 → 俯角 13°，
        // 球在 75% 高度，果岭、沙坑、旗杆都在画面里，能看清自己停在哪。
        this.desiredPosition
          .copy(ball)
          .addScaledVector(this.forward, -5.5)
          .addScaledVector(UP, 2.6)
        this.desiredTarget.copy(ball).addScaledVector(this.forward, 5).addScaledVector(UP, 0.1)
        lambda = 4
        break
      }
      case 'hole': {
        const angle = this.time * 0.5
        this.desiredPosition.set(
          ctx.cupPos.x + Math.sin(angle) * 3.4,
          ctx.cupPos.y + 1.5,
          ctx.cupPos.z + Math.cos(angle) * 3.4,
        )
        this.desiredTarget.copy(ctx.cupPos).addScaledVector(UP, 0.55)
        lambda = 3.5
        break
      }
    }

    if (!this.initialized) {
      this.smoothPosition.copy(this.desiredPosition)
      this.smoothTarget.copy(this.desiredTarget)
      this.initialized = true
    }

    const alpha = 1 - Math.exp(-lambda * dt)
    this.smoothPosition.lerp(this.desiredPosition, alpha)
    this.smoothTarget.lerp(this.desiredTarget, Math.min(1, alpha * 1.25))

    // 别让相机钻进坡里：净空按相机所在位置的地形高度算，而不是固定世界 Y
    const minY = ctx.groundAt(this.smoothPosition.x, this.smoothPosition.z) + 0.45
    if (this.smoothPosition.y < minY) this.smoothPosition.y = minY

    this.camera.position.copy(this.smoothPosition)
    this.camera.lookAt(this.smoothTarget)
  }
}
