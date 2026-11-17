import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  createBallState,
  launchBall,
  stepBall,
  type BallEnvironment,
  type PhysicsTerrain,
} from '../src/game/BallPhysics'
import { CLUBS, clubById, launchSpeed, type Club } from '../src/game/clubs'
import { BALL_RADIUS_M, FIXED_STEP_S } from '../src/game/physics.config'
import { Surface } from '../src/world/Surfaces'

/** 平地测试场：不受球场数据影响，专门用来校准距离 */
const flatFairway: PhysicsTerrain = {
  heightAt: () => 0,
  layerAt: () => Surface.Fairway,
  normalAt: (_x, _z, out) => out.set(0, 1, 0),
  waterSurfaceAt: () => null,
}

function environment(terrain: PhysicsTerrain = flatFairway): BallEnvironment {
  return { terrain, wind: new THREE.Vector3(), cup: { x: 0, z: -9999 } }
}

interface Shot {
  carryM: number
  totalM: number
  seconds: number
}

function simulate(club: Club, power: number): Shot {
  const env = environment()
  const state = createBallState(0, BALL_RADIUS_M, 0)
  launchBall(state, launchSpeed(club, power), club.launchAngleDeg, 0, club.spinRpm * power)

  let carryM = 0
  let firstTouch = false
  let seconds = 0

  for (let i = 0; i < 240 * 40 && !state.resting; i++) {
    stepBall(state, FIXED_STEP_S, env)
    seconds += FIXED_STEP_S
    if (!firstTouch && seconds > 0.3 && state.pos.y - BALL_RADIUS_M < 0.02) {
      firstTouch = true
      carryM = Math.hypot(state.pos.x, state.pos.z)
    }
  }

  return { carryM, totalM: Math.hypot(state.pos.x, state.pos.z), seconds }
}

describe('球杆距离（PLAN.md §2.2 / M2 验收）', () => {
  it('driver 满力飞行距离落在 200–265m', () => {
    const shot = simulate(clubById('driver'), 1)
    // eslint-disable-next-line no-console
    console.log('driver carry', shot.carryM.toFixed(1), 'total', shot.totalM.toFixed(1))
    expect(shot.carryM).toBeGreaterThan(200)
    expect(shot.carryM).toBeLessThan(265)
  })

  it('7 号铁满力在 135–175m', () => {
    const shot = simulate(clubById('iron7'), 1)
    console.log('iron7 carry', shot.carryM.toFixed(1), 'total', shot.totalM.toFixed(1))
    expect(shot.carryM).toBeGreaterThan(135)
    expect(shot.carryM).toBeLessThan(175)
  })

  it('挖起杆满力在 70–105m', () => {
    const shot = simulate(clubById('wedge'), 1)
    console.log('wedge carry', shot.carryM.toFixed(1), 'total', shot.totalM.toFixed(1))
    expect(shot.carryM).toBeGreaterThan(70)
    expect(shot.carryM).toBeLessThan(105)
  })
})

describe('物理稳定性', () => {
  it('所有球杆在任意力度下都会停下来，且不会反向飞', () => {
    for (const club of CLUBS) {
      for (const power of [0.15, 0.4, 0.75, 1]) {
        const shot = simulate(club, power)
        expect(shot.seconds).toBeLessThan(35)
        expect(Number.isFinite(shot.totalM)).toBe(true)
        expect(shot.totalM).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('相同输入得到完全相同的轨迹（确定性）', () => {
    const a = simulate(clubById('iron7'), 0.8)
    const b = simulate(clubById('iron7'), 0.8)
    expect(a.totalM).toBe(b.totalM)
    expect(a.seconds).toBe(b.seconds)
  })

  it('落在果岭上比落在长草上滚得更远', () => {
    const buildTerrain = (layer: number): PhysicsTerrain => ({
      heightAt: () => 0,
      layerAt: () => layer as never,
      normalAt: (_x, _z, out) => out.set(0, 1, 0),
      waterSurfaceAt: () => null,
    })

    const rollOn = (layer: number): number => {
      const env = environment(buildTerrain(layer))
      const state = createBallState(0, BALL_RADIUS_M, 0)
      // 低平推击，几乎不飞，只看滚动
      launchBall(state, 3.2, 0, 0, 0)
      for (let i = 0; i < 240 * 40 && !state.resting; i++) stepBall(state, FIXED_STEP_S, env)
      return Math.hypot(state.pos.x, state.pos.z)
    }

    expect(rollOn(Surface.Green)).toBeGreaterThan(rollOn(Surface.Rough))
  })
})
