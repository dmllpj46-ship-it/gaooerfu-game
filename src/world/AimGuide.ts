import * as THREE from 'three'

/**
 * 地面瞄准线（PLAN.md §2.3）。
 *
 * 之前瞄准是"盲瞄"：除了相机朝向和角色转身，屏幕上没有任何东西告诉玩家
 * 现在指着哪。这是"鼠标很难瞄准"里最容易被忽略、但影响最大的一条 ——
 * 精度再高，看不见落点方向也没用。
 *
 * 做法是从球沿瞄准方向铺一条**贴着地形**的渐窄飘带，而不是一条 Line：
 * WebGL 的线宽在绝大多数平台被钳死成 1px，在 1080p 下几乎看不见。
 * 飘带是一个三角带，宽度从 0.13m 收到 0.015m，用几何本身做渐隐，
 * 不需要顶点 alpha（`vertexColors` 的 RGBA 支持在 r187 里仍不稳）。
 */
export class AimGuide {
  readonly mesh: THREE.Mesh

  private readonly geometry: THREE.BufferGeometry
  private readonly positions: Float32Array
  /** 采样段数：44m / 40 段 ≈ 1.1m 一个采样点，足够贴合 4m 的地形网格 */
  private readonly segments = 40
  private readonly length = 44
  /** 起点离球 0.5m：太近会把球本身盖住 */
  private readonly startOffset = 0.5

  constructor(scene: THREE.Scene) {
    const count = (this.segments + 1) * 2
    this.positions = new Float32Array(count * 3)

    const indices: number[] = []
    for (let i = 0; i < this.segments; i++) {
      const a = i * 2
      const b = a + 1
      const c = a + 2
      const d = a + 3
      indices.push(a, b, c, b, d, c)
    }

    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setIndex(indices)
    // 顶点每帧在变，包围球必须手动给，否则会被错误剔除
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)

    const material = new THREE.MeshBasicMaterial({
      // 偏冷的薄荷白：纯白在草地上会灰掉，看着像一层雾；
      // 带一点 HUD 强调色（#7ee787）的色相才读得出"这是引导线"
      color: 0xe4ffe8,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      side: THREE.DoubleSide,
      // 贴着地形铺，5cm 抬升 + 深度偏移双保险：地形网格是 4m 三角面，
      // 采样点之间是线性插值，和 heightAt 的解析值最多差几厘米
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })

    this.mesh = new THREE.Mesh(this.geometry, material)
    this.mesh.name = 'aim-guide'
    this.mesh.renderOrder = 2
    this.mesh.frustumCulled = false
    this.mesh.visible = false
    scene.add(this.mesh)
  }

  /**
   * @param ballPos 球的位置
   * @param aimRad  瞄准方向（弧度，与角色 forward 同口径）
   * @param heightAt 地形高度采样
   */
  update(ballPos: THREE.Vector3, aimRad: number, heightAt: (x: number, z: number) => number): void {
    const fx = Math.sin(aimRad)
    const fz = Math.cos(aimRad)
    // 水平右向量，和 CameraRig 里 right = up × forward 一致
    const rx = fz
    const rz = -fx

    for (let i = 0; i <= this.segments; i++) {
      const t = i / this.segments
      const dist = this.startOffset + t * this.length
      const cx = ballPos.x + fx * dist
      const cz = ballPos.z + fz * dist
      const y = heightAt(cx, cz) + 0.05
      // 先快速收窄到约一个球宽，再缓慢收到 0.02：
      // 全程等比例收窄会变成一个锥形色块，看起来像地上的污渍而不是引导线
      const taper = Math.pow(t, 0.5)
      const halfWidth = 0.085 * (1 - taper) + 0.022 * taper

      const base = i * 6
      this.positions[base] = cx + rx * halfWidth
      this.positions[base + 1] = y
      this.positions[base + 2] = cz + rz * halfWidth
      this.positions[base + 3] = cx - rx * halfWidth
      this.positions[base + 4] = y
      this.positions[base + 5] = cz - rz * halfWidth
    }

    this.geometry.attributes.position.needsUpdate = true
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible
  }

  dispose(): void {
    this.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.mesh.removeFromParent()
  }
}
