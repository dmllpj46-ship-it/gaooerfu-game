import * as THREE from 'three'
import { Surface, SURFACES, type SurfaceId } from './Surfaces'
import { createNormalTexture, createNoiseTexture } from './Textures'
import type { CourseSpec, HoleSpec } from './CourseTypes'

/**
 * 高度场 + 面层掩码（PLAN.md §4.4）。
 * 物理采样（heightAt / layerAt / normalAt）与视觉网格（buildMesh）都从这同一份数据来，
 * 因此不会出现"看着是果岭、物理当长草"。
 */

const CELL_M = 2
/** 果岭压平的过渡半径倍数 */
const GREEN_BLEND = 1.8
const BUNKER_DEPTH_M = 0.3
const POND_EDGE_DROP_M = 0.45
const POND_CENTER_DROP_M = 1.5
/** 水面比岸线低这么多，形成浅滩 */
const POND_WATER_DROP_M = 0.3

export interface PondInfo {
  readonly x: number
  readonly z: number
  readonly radius: number
  readonly level: number
}

/** 地形基准起伏：平缓的林克斯式缓丘，振幅约 ±2.5m */
export function baseHeightAt(x: number, z: number): number {
  return (
    1.5 * Math.sin(x * 0.011) * Math.cos(z * 0.0075) +
    0.9 * Math.sin(z * 0.013 + x * 0.005) +
    0.35 * Math.sin((x - z) * 0.038) +
    0.2 * Math.cos(x * 0.07 + z * 0.01)
  )
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export class TerrainField {
  readonly minX: number
  readonly maxX: number
  readonly minZ: number
  readonly maxZ: number
  readonly ponds: PondInfo[] = []

  private readonly cols: number
  private readonly rows: number
  private readonly heights: Float32Array
  private readonly layers: Uint8Array

  constructor(spec: CourseSpec) {
    this.minX = spec.bounds.minX
    this.maxX = spec.bounds.maxX
    this.minZ = spec.bounds.minZ
    this.maxZ = spec.bounds.maxZ
    this.cols = Math.round((this.maxX - this.minX) / CELL_M) + 1
    this.rows = Math.round((this.maxZ - this.minZ) / CELL_M) + 1
    this.heights = new Float32Array(this.cols * this.rows)
    this.layers = new Uint8Array(this.cols * this.rows)

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c
        this.heights[i] = baseHeightAt(this.minX + c * CELL_M, this.minZ + r * CELL_M)
        this.layers[i] = Surface.Rough
      }
    }

    for (const hole of spec.holes) this.paintHole(hole)
  }

  heightAt(x: number, z: number): number {
    const fx = (x - this.minX) / CELL_M
    const fz = (z - this.minZ) / CELL_M
    if (fx < 0 || fz < 0 || fx > this.cols - 1 || fz > this.rows - 1) return baseHeightAt(x, z)

    const c0 = Math.floor(fx)
    const r0 = Math.floor(fz)
    const c1 = Math.min(c0 + 1, this.cols - 1)
    const r1 = Math.min(r0 + 1, this.rows - 1)
    const tx = fx - c0
    const tz = fz - r0

    const h00 = this.heights[r0 * this.cols + c0]
    const h10 = this.heights[r0 * this.cols + c1]
    const h01 = this.heights[r1 * this.cols + c0]
    const h11 = this.heights[r1 * this.cols + c1]

    const top = h00 + (h10 - h00) * tx
    const bottom = h01 + (h11 - h01) * tx
    return top + (bottom - top) * tz
  }

  layerAt(x: number, z: number): SurfaceId {
    const c = Math.round((x - this.minX) / CELL_M)
    const r = Math.round((z - this.minZ) / CELL_M)
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return Surface.Out
    return this.layers[r * this.cols + c] as SurfaceId
  }

  /** 解析法线：中心差分，用于反弹与滚动 */
  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const e = CELL_M
    const hx0 = this.heightAt(x - e, z)
    const hx1 = this.heightAt(x + e, z)
    const hz0 = this.heightAt(x, z - e)
    const hz1 = this.heightAt(x, z + e)
    return out.set(hx0 - hx1, 2 * e, hz0 - hz1).normalize()
  }

  /** 点在水塘范围内则返回水面高度，否则 null */
  waterSurfaceAt(x: number, z: number): number | null {
    for (const pond of this.ponds) {
      const dx = x - pond.x
      const dz = z - pond.z
      if (dx * dx + dz * dz < pond.radius * pond.radius) return pond.level
    }
    return null
  }

  isInBounds(x: number, z: number): boolean {
    return x > this.minX + 4 && x < this.maxX - 4 && z > this.minZ + 4 && z < this.maxZ - 4
  }

  private paintHole(hole: HoleSpec): void {
    const { tee, cup } = hole
    const dirX = cup.x - tee.x
    const dirZ = cup.z - tee.z
    const lengthSq = dirX * dirX + dirZ * dirZ || 1
    const greenHeight = baseHeightAt(cup.x, cup.z)

    for (const pond of hole.ponds) {
      this.ponds.push({
        x: pond.x,
        z: pond.z,
        radius: pond.radius,
        level: baseHeightAt(pond.x, pond.z) - POND_WATER_DROP_M,
      })
    }

    for (let r = 0; r < this.rows; r++) {
      const z = this.minZ + r * CELL_M
      for (let c = 0; c < this.cols; c++) {
        const x = this.minX + c * CELL_M
        const i = r * this.cols + c

        // 球道走廊：tee→cup 线段的投影距离
        const t = Math.min(1, Math.max(0, ((x - tee.x) * dirX + (z - tee.z) * dirZ) / lengthSq))
        const nx = tee.x + dirX * t
        const nz = tee.z + dirZ * t
        const corridorDist = Math.hypot(x - nx, z - nz)
        const halfWidth = hole.fairwayWidth * 0.5 * (0.75 + 0.35 * t)
        if (corridorDist < halfWidth) this.layers[i] = Surface.Fairway

        // 果岭：压平到 cup 高度，边缘平滑过渡
        const greenDist = Math.hypot(x - cup.x, z - cup.z)
        if (greenDist < hole.greenRadius * GREEN_BLEND) {
          const k = smoothstep(hole.greenRadius * GREEN_BLEND, hole.greenRadius, greenDist)
          if (k > 0) {
            this.heights[i] = this.heights[i] + (greenHeight - this.heights[i]) * k
            this.layers[i] = Surface.Green
          }
        }

        // 沙坑：轻微下凹
        for (const bunker of hole.bunkers) {
          const d = Math.hypot(x - bunker.x, z - bunker.z)
          if (d < bunker.radius) {
            this.layers[i] = Surface.Bunker
            this.heights[i] -= BUNKER_DEPTH_M * (1 - d / bunker.radius)
          }
        }

        // 水塘：碗形下挖，水面由 PondInfo 记录
        for (const pond of hole.ponds) {
          const d = Math.hypot(x - pond.x, z - pond.z)
          if (d < pond.radius) {
            const f = 1 - (d / pond.radius) ** 2
            const base = baseHeightAt(pond.x, pond.z)
            this.heights[i] = Math.min(
              this.heights[i],
              base - POND_EDGE_DROP_M - (POND_CENTER_DROP_M - POND_EDGE_DROP_M) * f,
            )
            this.layers[i] = Surface.Water
          }
        }
      }
    }
  }

  /** 生成视觉网格：stepCells 越大越省三角面（物理精度不受影响） */
  buildMesh(stepCells = 2): THREE.Mesh {
    const cols = Math.floor((this.cols - 1) / stepCells) + 1
    const rows = Math.floor((this.rows - 1) / stepCells) + 1
    const positions = new Float32Array(cols * rows * 3)
    const colors = new Float32Array(cols * rows * 3)
    // UV 直接用世界坐标（4m 一个平铺周期），不需要额外展开，
    // 也就不用担心接缝 —— 噪声贴图本身是可平铺的。
    const uvs = new Float32Array(cols * rows * 2)
    const color = new THREE.Color()

    // 面层颜色先按格算一遍，再做盒式模糊。
    // 直接用格子色的话，面层交界严格对齐到 4m 的顶点网格，
    // 果岭、沙坑、池塘看起来像贴在地面上的硬边椭圆 —— 地形网格越粗越明显。
    // ±2 格 = ±4m 的羽化，正好横跨两个顶点，边缘才有过渡。
    const cellCount = this.cols * this.rows
    const cellColors = new Float32Array(cellCount * 3)
    for (let i = 0; i < cellCount; i++) {
      color.setHex(SURFACES[this.layers[i] as SurfaceId].color)
      cellColors[i * 3] = color.r
      cellColors[i * 3 + 1] = color.g
      cellColors[i * 3 + 2] = color.b
    }

    const FEATHER = 2
    const blurred = new Float32Array(cellColors.length)
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        let sumR = 0
        let sumG = 0
        let sumB = 0
        let n = 0
        for (let dr = -FEATHER; dr <= FEATHER; dr++) {
          const rr = r + dr
          if (rr < 0 || rr >= this.rows) continue
          for (let dc = -FEATHER; dc <= FEATHER; dc++) {
            const cc = c + dc
            if (cc < 0 || cc >= this.cols) continue
            const j = (rr * this.cols + cc) * 3
            sumR += cellColors[j]
            sumG += cellColors[j + 1]
            sumB += cellColors[j + 2]
            n += 1
          }
        }
        const o = (r * this.cols + c) * 3
        blurred[o] = sumR / n
        blurred[o + 1] = sumG / n
        blurred[o + 2] = sumB / n
      }
    }

    let p = 0
    let q = 0
    for (let r = 0; r < rows; r++) {
      const gridR = Math.min(r * stepCells, this.rows - 1)
      const z = this.minZ + gridR * CELL_M
      for (let c = 0; c < cols; c++) {
        const gridC = Math.min(c * stepCells, this.cols - 1)
        const i = gridR * this.cols + gridC
        const x = this.minX + gridC * CELL_M

        positions[p] = x
        positions[p + 1] = this.heights[i]
        positions[p + 2] = z

        uvs[q] = x * 0.25
        uvs[q + 1] = z * 0.25
        q += 2

        const layer = this.layers[i] as SurfaceId
        // 剪草条纹 + 低频斑驳。真实球场沿球道方向有明暗交替的割草带，
        // 缺了它大面积纯绿在长焦下会像一块塑料板。
        //
        // 斑驳的频率必须远低于顶点间距：视觉网格 4m 一个顶点，
        // 原来用 sin(x*2.3+z*1.9)（波长 2.7m）比顶点间距还短，纯属走样，
        // 表现就是地面上浮出一层规整的菱形网格。现在给到 30m/15m 量级，
        // 高频细节交给 detailMap 和 normalMap 去表现。
        const stripe = 0.5 + 0.5 * Math.sin(z * 0.28)
        const grain = Math.sin(x * 0.19 + z * 0.23) * 0.5 + Math.sin(x * 0.41 - z * 0.33) * 0.5
        const stripeAmp = layer === Surface.Fairway || layer === Surface.Green ? 0.075 : 0.03
        const shade = 1 + (stripe - 0.5) * stripeAmp + grain * 0.018
        colors[p] = blurred[i * 3] * shade
        colors[p + 1] = blurred[i * 3 + 1] * shade
        colors[p + 2] = blurred[i * 3 + 2] * shade
        p += 3
      }
    }

    const indices: number[] = []
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c
        const b = a + 1
        const d = a + cols
        const e = d + 1
        indices.push(a, d, b, b, d, e)
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()

    // 法线贴图给草地微观起伏；颜色噪声让大面积纯绿有斑驳；
    // 粗糙度贴图让干湿不均，避免整片地形一个光泽。
    const normalMap = createNormalTexture(256, 4, 1337, 3.6)
    const detailMap = createNoiseTexture(256, 4, 55, 0.82, 1)
    const roughnessMap = createNoiseTexture(256, 3, 91, 0.68, 1)
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      map: detailMap,
      normalMap,
      normalScale: new THREE.Vector2(1.1, 1.1),
      roughnessMap,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.receiveShadow = true
    mesh.name = 'terrain'
    return mesh
  }
}
