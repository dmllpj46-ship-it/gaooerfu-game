import * as THREE from 'three'
import { settings } from './Settings'
import { Input } from './Input'
import { createStatsChip, type StatsChip } from '../debug/DebugPanel'
import { createRenderer, type RendererView } from '../render/Renderer'
import { CameraRig } from '../render/CameraRig'
import { createSky, SKY_COLORS, type SkyView } from '../world/Sky'
import { CourseView } from '../world/Course'
import { course01 } from '../world/courses/course01'
import { Surface, surfaceLabel } from '../world/Surfaces'
import { CLUBS, launchSpeed } from '../game/clubs'
import { createBallState, launchBall, resetBall, stepBall, type BallEnvironment } from '../game/BallPhysics'
import { BALL_RADIUS_M, FIXED_STEP_S, MAX_SUBSTEPS } from '../game/physics.config'
import { BallView } from '../game/Ball'
import { Round } from '../game/Round'
import { relativeToPar, scoreName, totalPar, totalStrokes } from '../game/Scoring'
import { Golfer } from '../char/Golfer'
import { ADDRESS_POSE, SwingAnimator } from '../char/SwingAnimator'
import { Hud } from '../ui/HUD'
import { Screens } from '../ui/Screens'
import { Sfx } from '../audio/Sfx'
import { Grass } from '../world/Grass'
import { Treeline } from '../world/Treeline'
import { AimGuide } from '../world/AimGuide'
import { ImpactParticles } from '../render/ImpactParticles'

type GameState = 'title' | 'address' | 'swing' | 'flight' | 'overlay'

const MAX_DELTA_S = 0.05
const MAX_FLIGHT_S = 25

/** syncHud 里算相机朝向用的临时向量，避免每次调用都 new 一个 */
const _camForward = new THREE.Vector3()

export class Game {
  private readonly scene = new THREE.Scene()
  private readonly course = new CourseView(course01)
  private readonly golfer = new Golfer()
  private readonly swing = new SwingAnimator()
  private readonly screens = new Screens()
  private readonly sfx = new Sfx()
  private readonly grass = new Grass(this.scene, this.course.terrain)
  private readonly treeline = new Treeline(this.scene, this.course.terrain)
  private readonly aimGuide = new AimGuide(this.scene)
  private readonly particles = new ImpactParticles(this.scene)
  private readonly round: Round
  private readonly view: RendererView
  private readonly rig: CameraRig
  private readonly sky: SkyView
  private readonly ballView: BallView
  private readonly hud: Hud
  private readonly input: Input
  private readonly stats: StatsChip
  private readonly timer = new THREE.Timer()

  private readonly ballState = createBallState()
  private readonly windVector = new THREE.Vector3()
  private readonly ballEnv: BallEnvironment
  private readonly lastSafe = new THREE.Vector3()

  private clubIndex = 0
  private aimRad = 0
  private state: GameState = 'title'
  private paused = false
  private accumulator = 0
  private flightStartedAt = 0
  private elapsed = 0
  private rafId = 0
  /** 落地机位展示完再切回越肩，避免球一停镜头就跳 */
  private pendingMode: 'address' | 'putt' | null = null
  private pendingModeAt = 0

  constructor(canvas: HTMLCanvasElement) {
    this.rig = new CameraRig(canvas.clientWidth / canvas.clientHeight || 1.7)
    this.view = createRenderer(canvas, settings.maxPixelRatio, this.scene, this.rig.camera)

    // 雾色必须按 LinearSRGB 解释，和 Sky.ts 里的天穹同一套口径；
    // 否则同样的 hex 在天空上是亮蓝、在地面上是灰蓝，地平线会留下一道硬边。
    const fogColor = new THREE.Color().setHex(SKY_COLORS.horizon, THREE.LinearSRGBColorSpace)
    // near 100 保住 100m 内落点清晰，far 380 让 380m 外彻底融进天色。
    // 地平线以下的地面在屏幕上被压成十几像素，雾必须够近才不会留下一条均匀的深绿带。
    this.scene.fog = new THREE.Fog(fogColor, 100, 380)
    this.sky = createSky(this.scene, this.view.renderer)
    this.scene.add(this.course.group)
    this.ballView = new BallView(this.scene)
    this.scene.add(this.golfer.group)

    this.round = new Round(this.course)
    this.ballEnv = { terrain: this.course.terrain, wind: this.windVector, cup: { x: 0, z: 0 } }

    this.hud = new Hud((index) => this.selectClub(index))
    this.input = new Input(canvas, {
      baseAim: () => this.aimRad,
      canAim: () => this.state === 'address' && !this.paused && !this.screens.visible,
      onAim: (power, aimRad) => {
        this.aimRad = aimRad
        this.hud.setPower(power, true)
        this.hud.setAim(this.aimOffsetDeg())
        this.golfer.place(this.ballState.pos, this.aimRad)
      },
      onSwing: (power, aimRad) => {
        this.aimRad = aimRad
        this.hud.setPower(0, false)
        this.startSwing(power)
      },
      onAimEnd: (aimRad) => {
        // 只调方向不出杆：收掉力度条，把新方向固定下来
        this.aimRad = aimRad
        this.hud.setPower(0, false)
        this.hud.setAim(this.aimOffsetDeg())
        this.golfer.place(this.ballState.pos, this.aimRad)
      },
      onCancel: () => {
        this.hud.setPower(0, false)
        this.aimRad = this.aimTowardsCup()
        this.hud.setAim(0)
      },
      onClub: (index) => this.selectClub(index),
      onNudgeAim: (deltaRad) => {
        if (this.state !== 'address' || this.paused || this.screens.visible) return
        this.aimRad += deltaRad
        this.hud.setAim(this.aimOffsetDeg())
        this.golfer.place(this.ballState.pos, this.aimRad)
      },
      onConfirm: () => {
        if (this.screens.visible) this.screens.confirm()
      },
      onPauseToggle: () => this.togglePause(),
    })
    this.stats = createStatsChip(settings.debug)

    this.setupTitleScene()
    this.screens.showTitle(() => {
      this.sfx.unlock()
      this.startRound()
    })

    this.resize()
    window.addEventListener('resize', this.resize)
  }

  start(): void {
    if (this.rafId !== 0) return
    this.timer.connect(document)

    const tick = (timestamp: number): void => {
      this.rafId = requestAnimationFrame(tick)
      this.timer.update(timestamp)
      this.update(Math.min(this.timer.getDelta(), MAX_DELTA_S))
    }
    this.rafId = requestAnimationFrame(tick)
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId)
    this.rafId = 0
    window.removeEventListener('resize', this.resize)
    this.timer.dispose()
    this.input.dispose()
    this.hud.dispose()
    this.screens.dispose()
    this.sfx.dispose()
    this.stats.dispose()
    this.sky.dispose()
    this.ballView.dispose()
    this.golfer.dispose()
    this.grass.dispose()
    this.treeline.dispose()
    this.aimGuide.dispose()
    this.particles.dispose()
    this.course.dispose()
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose()
        const material = object.material
        if (Array.isArray(material)) for (const item of material) item.dispose()
        else material.dispose()
      }
    })
    this.view.dispose()
  }

  // ---------------------------------------------------------------- 回合流程

  private startRound(): void {
    this.round.reset()
    this.beginHole()
  }

  private beginHole(): void {
    const hole = this.round.hole
    this.paused = false
    this.screens.hide()

    this.ballEnv.cup.x = hole.spec.cup.x
    this.ballEnv.cup.z = hole.spec.cup.z
    this.windVector.copy(hole.wind)

    const tee = this.course.teePosition(this.round.holeIndex)
    this.aimRad = Math.atan2(hole.spec.cup.x - tee.x, hole.spec.cup.z - tee.z)
    this.setBallAt(tee.x, tee.z)
    this.clubIndex = this.suggestClub()
    this.golfer.setClub(CLUBS[this.clubIndex])
    this.state = 'address'
    this.rig.setMode('address')
    this.pendingMode = null
    this.syncHud()
    this.hud.toast(`第 ${this.round.holeNumber} 洞 · 标准杆 ${this.round.par}`, 'info')
  }

  private startSwing(power: number): void {
    if (this.state !== 'address') return
    this.round.addStroke()
    this.hud.dismissHint()
    this.state = 'swing'
    this.accumulator = 0
    this.sfx.swing()
    // 回调只会在下杆到底时触发一次（SwingAnimator 内部幂等）
    this.swing.begin(power, () => this.onImpact(power))
    this.syncHud()
  }

  private onImpact(power: number): void {
    const club = CLUBS[this.clubIndex]
    launchBall(this.ballState, launchSpeed(club, power), club.launchAngleDeg, this.aimRad, club.spinRpm * power)
    this.sfx.hit(power)
    this.ballView.clearTrail()
    this.pendingMode = null
    this.flightStartedAt = this.elapsed
    this.accumulator = 0
    this.state = 'flight'
    this.rig.setMode('flight')
    this.particles.burst(this.ballState.pos, power)
  }

  private onSettled(): void {
    const position = this.ballState.pos
    const ground = this.course.terrain.heightAt(position.x, position.z)
    this.ballView.showMarker(position.x, ground, position.z)
    this.particles.burst(new THREE.Vector3(position.x, ground + 0.03, position.z), 0.3)

    if (!this.course.terrain.isInBounds(position.x, position.z)) {
      this.round.addPenalty()
      this.hud.toast('界外 +1 罚杆', 'bad')
      this.returnToSafe()
      return
    }

    this.lastSafe.copy(position)
    this.state = 'address'
    const layer = this.course.terrain.layerAt(position.x, position.z)
    // 先给一个高的"落地机位" 1.1s，再交给越肩/推杆机位
    this.rig.setMode('landing')
    this.pendingMode = layer === Surface.Green ? 'putt' : 'address'
    this.pendingModeAt = this.elapsed + 1.1
    this.clubIndex = this.suggestClub()
    this.golfer.setClub(CLUBS[this.clubIndex])
    this.aimRad = this.aimTowardsCup()
    this.hud.toast(`球停在${surfaceLabel(layer)} · 剩余 ${Math.round(this.distanceToCup())} m`, 'info')
    this.syncHud()
  }

  private onSplash(): void {
    this.sfx.splash()
    this.round.addPenalty()
    this.hud.toast('落水 +1 罚杆', 'bad')
    this.returnToSafe()
  }

  private onHoled(): void {
    this.sfx.cup()
    this.ballView.clearTrail()
    this.state = 'overlay'
    this.rig.setMode('hole')

    const strokes = this.round.strokeCount
    const par = this.round.par
    const holeNumber = this.round.holeNumber
    const nextPar = this.round.nextPar
    const label = scoreName(strokes, par)
    this.round.finishHole()

    if (this.round.isComplete) {
      const results = this.round.results
      let bestIndex = 0
      results.forEach((result, index) => {
        if (result.strokes - result.par < results[bestIndex].strokes - results[bestIndex].par) bestIndex = index
      })
      const bestHole = this.course.holes[bestIndex]
      const best = `第 ${bestHole.spec.index} 洞 ${scoreName(results[bestIndex].strokes, results[bestIndex].par)}`
      this.screens.showRoundComplete({
        strokes: totalStrokes(results),
        par: totalPar(results),
        relative: relativeToPar(results),
        best,
        onRestart: () => this.startRound(),
      })
    } else {
      this.screens.showHoleComplete({
        holeNumber,
        par,
        strokes,
        scoreName: label,
        nextPar,
        onNext: () => this.beginHole(),
      })
    }
    this.syncHud()
  }

  private returnToSafe(): void {
    resetBall(this.ballState, this.lastSafe.x, this.lastSafe.y, this.lastSafe.z)
    this.ballView.clearTrail()
    const ground = this.course.terrain.heightAt(this.lastSafe.x, this.lastSafe.z)
    this.ballView.showMarker(this.lastSafe.x, ground, this.lastSafe.z)
    this.state = 'address'
    this.rig.setMode('address')
    this.clubIndex = this.suggestClub()
    this.golfer.setClub(CLUBS[this.clubIndex])
    this.aimRad = this.aimTowardsCup()
    this.pendingMode = null
    this.syncHud()
  }

  // ---------------------------------------------------------------- 每帧

  private update(dt: number): void {
    this.elapsed += dt
    this.course.update(this.elapsed)
    this.grass.update(this.elapsed)
    // 天穹必须每帧跟随相机：球心留在原点的话，走到球场尽头时
    // shader 里 (worldPosition - cameraPosition) 的方向会明显失真
    this.sky.update(this.rig.camera, this.elapsed)

    if (!this.paused) {
      if (this.state === 'flight') this.stepPhysics(dt)

      this.swing.update(dt)
      this.golfer.update(dt, !this.swing.isActive)
      this.golfer.setPose(this.swing.isActive ? this.swing.pose : ADDRESS_POSE, dt, this.swing.isActive)

      if (this.state === 'address' || this.state === 'swing') {
        this.golfer.place(this.ballState.pos, this.aimRad)
        // 瞄准线只在真正能调整方向时出现：飞行/结算期间留着会误导
        this.aimGuide.setVisible(this.state === 'address')
        this.aimGuide.update(this.ballState.pos, this.aimRad, this.heightAt)
      } else {
        this.aimGuide.setVisible(false)
      }
      if (this.state === 'flight') this.ballView.pushTrail(this.ballState.pos)
      this.ballView.update(dt)
      this.particles.update(dt)

      if (this.pendingMode && this.state === 'address' && this.elapsed >= this.pendingModeAt) {
        this.rig.setMode(this.pendingMode)
        this.pendingMode = null
      }
    }

    this.syncShadowFocus()
    this.rig.update(dt, {
      ballPos: this.ballState.pos,
      ballVel: this.ballState.vel,
      aimRad: this.aimRad,
      cupPos: this.cupPosition(),
      golferPos: this.golfer.group.position,
      groundAt: (x, z) => this.course.terrain.heightAt(x, z),
    })
    this.ballView.sync(this.ballState.pos, this.course.terrain.heightAt(this.ballState.pos.x, this.ballState.pos.z))

    // 罗盘必须每帧跟相机：机位过渡期间朝向一直在变，只在 syncHud 里算会指错方向
    this.rig.camera.getWorldDirection(_camForward)
    const cameraYaw = Math.atan2(_camForward.x, _camForward.z)
    const windDir = Math.atan2(this.windVector.x, this.windVector.z)
    this.hud.setWindDeg(THREE.MathUtils.radToDeg(cameraYaw - windDir))

    this.view.render()
    this.stats.update(dt, this.view.renderer)
  }

  /** 固定 1/240s 步长 + 子步上限（AGENTS.md 不变量 2） */
  private stepPhysics(dt: number): void {
    this.accumulator += dt
    let steps = 0

    while (this.accumulator >= FIXED_STEP_S && steps < MAX_SUBSTEPS && this.state === 'flight') {
      const events = stepBall(this.ballState, FIXED_STEP_S, this.ballEnv)
      this.accumulator -= FIXED_STEP_S
      steps += 1

      if (events.bounced) this.sfx.land(0.45)
      if (events.splashed) {
        this.onSplash()
        return
      }
      if (events.holed) {
        this.onHoled()
        return
      }
      if (events.stopped) {
        this.onSettled()
        return
      }
    }

    if (this.accumulator > FIXED_STEP_S * MAX_SUBSTEPS) this.accumulator = 0

    // 兜底：万一球卡在某个状态里，25 秒后强制结算，避免回合卡死
    if (this.state === 'flight' && this.elapsed - this.flightStartedAt > MAX_FLIGHT_S) {
      this.ballState.resting = true
      this.ballState.vel.set(0, 0, 0)
      this.onSettled()
    }
  }

  // ---------------------------------------------------------------- 辅助

  private setBallAt(x: number, z: number): void {
    const ground = this.course.terrain.heightAt(x, z)
    const y = ground + BALL_RADIUS_M
    resetBall(this.ballState, x, y, z)
    this.lastSafe.set(x, y, z)
    this.ballView.clearTrail()
    this.ballView.showMarker(x, ground, z)
    this.ballView.sync(this.ballState.pos, ground)
    this.golfer.place(this.ballState.pos, this.aimRad)
    this.grass.scatter(x, z, 30)
  }

  private selectClub(index: number): void {
    if (!CLUBS[index] || this.state === 'flight' || this.state === 'swing') return
    this.clubIndex = index
    this.golfer.setClub(CLUBS[index])
    this.syncHud()
  }

  private suggestClub(): number {
    const layer = this.course.terrain.layerAt(this.ballState.pos.x, this.ballState.pos.z)
    const distance = this.distanceToCup()
    if (layer === Surface.Green || distance < 16) return 3
    if (layer === Surface.Bunker) return 2
    if (distance > 200) return 0
    if (distance > 115) return 1
    return 2
  }

  private aimTowardsCup(): number {
    return Math.atan2(this.ballEnv.cup.x - this.ballState.pos.x, this.ballEnv.cup.z - this.ballState.pos.z)
  }

  /** 地形高度采样的稳定引用，避免每帧 new 闭包传给瞄准线 */
  private readonly heightAt = (x: number, z: number): number => this.course.terrain.heightAt(x, z)

  /**
   * 当前瞄准相对"球→洞"方向偏了多少度（正 = 屏幕右侧）。
   * HUD 用它显示"偏左 / 偏右 N°"，玩家才知道自己是不是真的对准了。
   */
  private aimOffsetDeg(): number {
    let delta = this.aimRad - this.aimTowardsCup()
    while (delta > Math.PI) delta -= Math.PI * 2
    while (delta < -Math.PI) delta += Math.PI * 2
    return (delta * 180) / Math.PI
  }

  private distanceToCup(): number {
    return Math.hypot(this.ballEnv.cup.x - this.ballState.pos.x, this.ballEnv.cup.z - this.ballState.pos.z)
  }

  private cupPosition(): THREE.Vector3 {
    return new THREE.Vector3(
      this.ballEnv.cup.x,
      this.course.terrain.heightAt(this.ballEnv.cup.x, this.ballEnv.cup.z),
      this.ballEnv.cup.z,
    )
  }

  /** 阴影相机跟着球走，44m 的阴影范围内始终有球和角色 */
  private syncShadowFocus(): void {
    const focus = this.ballState.pos
    const target = this.sky.sunLight.target
    target.position.set(focus.x, 0, focus.z)
    target.updateMatrixWorld()
    this.sky.sunLight.position.copy(target.position).addScaledVector(this.sky.sunDirection, 120)
  }

  private togglePause(): void {
    if (this.state === 'title' || this.state === 'overlay') return
    this.paused = !this.paused
    if (this.paused) {
      this.screens.showPaused(() => this.resume())
    } else {
      this.screens.hide()
    }
  }

  private resume(): void {
    this.paused = false
    this.screens.hide()
  }

  private syncHud(): void {
    const windSpeed = Math.hypot(this.windVector.x, this.windVector.z)
    const windDir = Math.atan2(this.windVector.x, this.windVector.z)
    // 罗盘箭头要相对屏幕转：相机看向哪，0 度就在哪
    this.rig.camera.getWorldDirection(_camForward)
    const cameraYaw = Math.atan2(_camForward.x, _camForward.z)
    this.hud.update({
      holeNumber: this.round.holeNumber,
      holeCount: this.round.holeCount,
      par: this.round.par,
      strokes: this.round.strokeCount,
      distanceM: this.distanceToCup(),
      // CSS 的 rotate 正值是顺时针，而世界角 atan2(x, z) 增大在屏幕上是逆时针
      // （因为相机右方是 -x），所以这里要取反，否则箭头会指反 180°
      windDeg: THREE.MathUtils.radToDeg(cameraYaw - windDir),
      windSpeedMps: windSpeed,
      lieLabel: surfaceLabel(this.course.terrain.layerAt(this.ballState.pos.x, this.ballState.pos.z)),
      clubIndex: this.clubIndex,
    })
    // 换杆/换洞/落地回位都会把瞄准重置到"球→洞"，读数必须跟着走，
    // 否则上一杆的"偏右 3.4°"会一直挂在屏幕上。飞行/结算期间收起。
    this.hud.setAim(this.aimOffsetDeg(), this.state === 'address')
  }

  private setupTitleScene(): void {
    const hole = this.course.holes[0]
    this.ballEnv.cup.x = hole.spec.cup.x
    this.ballEnv.cup.z = hole.spec.cup.z
    this.windVector.copy(hole.wind)
    const tee = this.course.teePosition(0)
    this.aimRad = Math.atan2(hole.spec.cup.x - tee.x, hole.spec.cup.z - tee.z)
    this.setBallAt(tee.x, tee.z)
    this.golfer.setClub(CLUBS[0])
    this.rig.setMode('title')
    this.syncHud()
  }

  private readonly resize = (): void => {
    const canvas = this.view.renderer.domElement
    const width = canvas.clientWidth || window.innerWidth
    const height = canvas.clientHeight || window.innerHeight
    this.rig.resize(width / height)
    this.view.resize()
  }
}
