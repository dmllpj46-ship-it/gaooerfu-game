import * as THREE from 'three'
import {
  AIR_DENSITY_KG_M3,
  BALL_AREA_M2,
  BALL_MASS_KG,
  BALL_RADIUS_M,
  BOUNCE_SPEED_MPS,
  CUP_MAX_SPEED_MPS,
  CUP_RADIUS_M,
  DRAG_COEFF,
  DRAG_SPIN_REDUCTION,
  GRAVITY_MPS2,
  LIFT_COEFF_PER_SPIN_RATIO,
  MAX_BALL_SPEED_MPS,
  MAX_LIFT_COEFF,
  REST_SPEED_MPS,
  SPIN_DECAY_PER_S,
} from './physics.config'
import { SURFACES, type SurfaceId } from '../world/Surfaces'

/**
 * 球体物理（AGENTS.md 不变量 1）：只依赖入参，不读 DOM / 相机 / 时间。
 * 由调用方以固定 1/240s 步长驱动，因此同一输入必然得到同一轨迹。
 */

export interface BallState {
  readonly pos: THREE.Vector3
  readonly vel: THREE.Vector3
  /** 角速度矢量（rad/s），方向按右手定则 */
  readonly spin: THREE.Vector3
  resting: boolean
}

export interface PhysicsTerrain {
  heightAt(x: number, z: number): number
  layerAt(x: number, z: number): SurfaceId
  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3
  waterSurfaceAt(x: number, z: number): number | null
}

export interface BallEnvironment {
  readonly terrain: PhysicsTerrain
  readonly wind: THREE.Vector3
  readonly cup: { x: number; z: number }
}

export interface StepEvents {
  /** 本步发生有意义的反弹（用于音效/尘粒节流） */
  bounced: boolean
  splashed: boolean
  holed: boolean
  stopped: boolean
}

// 复用临时向量，热路径零分配
const _rel = new THREE.Vector3()
const _acc = new THREE.Vector3()
const _liftDir = new THREE.Vector3()
const _n = new THREE.Vector3()
const _g = new THREE.Vector3()
const _tangent = new THREE.Vector3()

export function createBallState(x = 0, y = BALL_RADIUS_M, z = 0): BallState {
  return {
    pos: new THREE.Vector3(x, y, z),
    vel: new THREE.Vector3(),
    spin: new THREE.Vector3(),
    resting: true,
  }
}

/** 击球：把杆种参数换算成初速度与后旋 */
export function launchBall(
  state: BallState,
  speedMps: number,
  angleDeg: number,
  aimRad: number,
  spinRpm: number,
): void {
  const dirX = Math.sin(aimRad)
  const dirZ = Math.cos(aimRad)
  const angle = THREE.MathUtils.degToRad(angleDeg)
  const horizontal = Math.cos(angle) * speedMps

  state.vel.set(dirX * horizontal, Math.sin(angle) * speedMps, dirZ * horizontal)

  // 后旋轴 = (-dz, 0, dx)，保证 ω × v 指向上方（产生升力）
  const omega = (spinRpm * Math.PI * 2) / 60
  state.spin.set(-dirZ, 0, dirX).normalize().multiplyScalar(omega)
  state.resting = false
}

export function stepBall(state: BallState, dt: number, env: BallEnvironment): StepEvents {
  const events: StepEvents = { bounced: false, splashed: false, holed: false, stopped: false }
  if (state.resting) return events

  // 1. 加速度 = 重力 + 阻力 + 升力（都以相对风的速度计算）
  _rel.copy(state.vel).sub(env.wind)
  const relSpeed = _rel.length()
  _acc.set(0, -GRAVITY_MPS2, 0)
  if (relSpeed > 1e-4) {
    const spinMag = state.spin.length()
    const spinRatio = (spinMag * BALL_RADIUS_M) / relSpeed
    const liftCoeff = Math.min(MAX_LIFT_COEFF, LIFT_COEFF_PER_SPIN_RATIO * spinRatio)
    const dragCoeff = DRAG_COEFF * (1 - DRAG_SPIN_REDUCTION * Math.min(spinRatio, 2))
    // q = 动压 · 迎风面积 / 质量，即单位速度下的加速度量级
    const q = (0.5 * AIR_DENSITY_KG_M3 * BALL_AREA_M2 * relSpeed * relSpeed) / BALL_MASS_KG

    _acc.addScaledVector(_rel, -q * dragCoeff / relSpeed)

    if (liftCoeff > 1e-4 && spinMag > 1e-3) {
      _liftDir.crossVectors(state.spin, _rel)
      if (_liftDir.lengthSq() > 1e-8) _acc.addScaledVector(_liftDir.normalize(), q * liftCoeff)
    }
  }
  state.vel.addScaledVector(_acc, dt)
  if (state.vel.length() > MAX_BALL_SPEED_MPS) state.vel.setLength(MAX_BALL_SPEED_MPS)

  // 2. 位移
  state.pos.addScaledVector(state.vel, dt)

  // 3. 空中自旋衰减
  state.spin.multiplyScalar(Math.max(0, 1 - SPIN_DECAY_PER_S * dt))

  // 4. 入水：水面以下即视为落水
  const waterLevel = env.terrain.waterSurfaceAt(state.pos.x, state.pos.z)
  if (waterLevel !== null && state.pos.y - BALL_RADIUS_M * 0.5 <= waterLevel) {
    events.splashed = true
    state.resting = true
    state.vel.set(0, 0, 0)
    state.spin.set(0, 0, 0)
    return events
  }

  // 5. 地面接触
  const groundHeight = env.terrain.heightAt(state.pos.x, state.pos.z)
  if (state.pos.y - BALL_RADIUS_M <= groundHeight) {
    const layer = env.terrain.layerAt(state.pos.x, state.pos.z)
    const props = SURFACES[layer] ?? SURFACES[1]
    state.pos.y = groundHeight + BALL_RADIUS_M

    const normal = env.terrain.normalAt(state.pos.x, state.pos.z, _n)
    const verticalSpeed = state.vel.dot(normal)

    if (verticalSpeed < 0) {
      state.vel.addScaledVector(normal, -verticalSpeed * (1 + props.restitution))

      // 真正的砸地才扣切向速度。注意不能对每个接触子步都扣：
      // 贴地滚动时重力每步会带来 -0.04 m/s 的微小法向速度，
      // 若在这里一律减 24%，速度会按 0.76^4 每秒指数衰减（推杆 4.95 → 1.64 → 0.54）。
      if (verticalSpeed < -BOUNCE_SPEED_MPS) {
        events.bounced = true
        state.spin.multiplyScalar(0.35)
        _tangent.copy(state.vel).addScaledVector(normal, -state.vel.dot(normal))
        state.vel.addScaledVector(_tangent, -0.24)
      }
    }

    // 法向速度已经很小 → 贴地滚动
    if (Math.abs(state.vel.dot(normal)) < BOUNCE_SPEED_MPS) {
      state.vel.addScaledVector(normal, -state.vel.dot(normal))
      state.pos.y = groundHeight + BALL_RADIUS_M

      // 坡度分量：重力的切向投影
      _g.set(0, -GRAVITY_MPS2, 0)
      _g.addScaledVector(normal, -_g.dot(normal))
      state.vel.addScaledVector(_g, dt)

      // 滚动摩擦：按速度量值扣减，避免零点附近抖动
      const speed = state.vel.length()
      const decel = props.rollingFriction * GRAVITY_MPS2 * dt
      if (speed > 1e-6) {
        const next = Math.max(0, speed - decel)
        state.vel.multiplyScalar(next / speed)
      }

      // 进洞判定：只在地面附近、速度不大时成立
      const dx = state.pos.x - env.cup.x
      const dz = state.pos.z - env.cup.z
      if (Math.hypot(dx, dz) < CUP_RADIUS_M + BALL_RADIUS_M && state.vel.length() < CUP_MAX_SPEED_MPS) {
        events.holed = true
        state.resting = true
        state.vel.set(0, 0, 0)
        state.spin.set(0, 0, 0)
        state.pos.set(env.cup.x, env.terrain.heightAt(env.cup.x, env.cup.z) + BALL_RADIUS_M, env.cup.z)
        return events
      }

      if (state.vel.length() < REST_SPEED_MPS) {
        state.resting = true
        state.vel.set(0, 0, 0)
        state.spin.set(0, 0, 0)
        events.stopped = true
      }
    }
  }

  return events
}

/** 从静止状态推一把（例如罚杆后重摆） */
export function resetBall(state: BallState, x: number, y: number, z: number): void {
  state.pos.set(x, y, z)
  state.vel.set(0, 0, 0)
  state.spin.set(0, 0, 0)
  state.resting = true
}
