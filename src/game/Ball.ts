import * as THREE from 'three'
import { BALL_RADIUS_M } from './physics.config'

/** 视觉放大倍数：远距离时小球仍可辨认（PLAN.md §5 视觉清单） */
export const BALL_VISUAL_SCALE = 1.6

const TRAIL_POINTS = 260
const MARKER_LIFE_S = 2.2

/** 球的可见表现：球体 + 弹道拖尾 + 落点标记 + 接触阴影 */
export class BallView {
  private readonly ball: THREE.Mesh
  private readonly contactShadow: THREE.Mesh
  private readonly marker: THREE.Mesh
  private readonly trail: THREE.Line
  private readonly trailPositions: Float32Array
  private trailCount = 0
  private markerLife = 0

  private readonly geometries: THREE.BufferGeometry[] = []
  private readonly materials: THREE.Material[] = []

  constructor(scene: THREE.Scene) {
    const radius = BALL_RADIUS_M * BALL_VISUAL_SCALE

    const ballGeometry = new THREE.SphereGeometry(radius, 40, 28)
    const ballMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.28,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      envMapIntensity: 1.3,
    })
    this.ball = new THREE.Mesh(ballGeometry, ballMaterial)
    this.ball.castShadow = true
    this.ball.receiveShadow = true
    this.ball.name = 'ball'
    scene.add(this.ball)

    const shadowGeometry = new THREE.CircleGeometry(radius * 2.4, 20)
    shadowGeometry.rotateX(-Math.PI / 2)
    const shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x0a1408,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    })
    this.contactShadow = new THREE.Mesh(shadowGeometry, shadowMaterial)
    this.contactShadow.renderOrder = 1
    scene.add(this.contactShadow)

    const markerGeometry = new THREE.RingGeometry(0.34, 0.46, 40)
    markerGeometry.rotateX(-Math.PI / 2)
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: 0xfff2b0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    this.marker = new THREE.Mesh(markerGeometry, markerMaterial)
    this.marker.renderOrder = 2
    scene.add(this.marker)

    this.trailPositions = new Float32Array(TRAIL_POINTS * 3)
    const trailGeometry = new THREE.BufferGeometry()
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3))
    trailGeometry.setDrawRange(0, 0)
    const trailMaterial = new THREE.LineBasicMaterial({
      color: 0xfff8e0,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    })
    this.trail = new THREE.Line(trailGeometry, trailMaterial)
    this.trail.frustumCulled = false
    scene.add(this.trail)

    this.geometries.push(ballGeometry, shadowGeometry, markerGeometry, trailGeometry)
    this.materials.push(ballMaterial, shadowMaterial, markerMaterial, trailMaterial)
  }

  setVisible(visible: boolean): void {
    this.ball.visible = visible
    this.contactShadow.visible = visible
  }

  /** 每帧同步球与接触阴影；groundHeight 用物理地形的采样值，保证贴地 */
  sync(position: THREE.Vector3, groundHeight: number): void {
    this.ball.position.copy(position)

    const heightAbove = Math.max(0, position.y - groundHeight)
    this.contactShadow.position.set(position.x, groundHeight + 0.006, position.z)
    const fade = Math.max(0, 1 - heightAbove / 6)
    const material = this.contactShadow.material as THREE.MeshBasicMaterial
    material.opacity = 0.3 * fade
    this.contactShadow.scale.setScalar(1 + heightAbove * 0.35)
  }

  pushTrail(position: THREE.Vector3): void {
    if (this.trailCount >= TRAIL_POINTS) return
    const offset = this.trailCount * 3
    this.trailPositions[offset] = position.x
    this.trailPositions[offset + 1] = position.y
    this.trailPositions[offset + 2] = position.z
    this.trailCount += 1
    this.trail.geometry.setDrawRange(0, this.trailCount)
    const attribute = this.trail.geometry.getAttribute('position') as THREE.BufferAttribute
    attribute.needsUpdate = true
  }

  clearTrail(): void {
    this.trailCount = 0
    this.trail.geometry.setDrawRange(0, 0)
  }

  showMarker(x: number, y: number, z: number): void {
    this.marker.position.set(x, y + 0.02, z)
    this.markerLife = MARKER_LIFE_S
  }

  update(dt: number): void {
    if (this.markerLife > 0) {
      this.markerLife = Math.max(0, this.markerLife - dt)
      const material = this.marker.material as THREE.MeshBasicMaterial
      const t = this.markerLife / MARKER_LIFE_S
      material.opacity = 0.55 * t
      this.marker.scale.setScalar(1 + (1 - t) * 0.6)
    }
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose()
    for (const material of this.materials) material.dispose()
  }
}
