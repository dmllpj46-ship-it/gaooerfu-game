import * as THREE from 'three'
import type { CourseSpec, HoleSpec } from './CourseTypes'
import { TerrainField } from './Terrain'
import { createNormalTexture } from './Textures'

export interface CourseHole {
  readonly spec: HoleSpec
  /** 风矢量（m/s），物理与 HUD 共用 */
  readonly wind: THREE.Vector3
}

function windVector(wind: HoleSpec['wind']): THREE.Vector3 {
  const rad = THREE.MathUtils.degToRad(wind.dirDeg)
  return new THREE.Vector3(Math.sin(rad) * wind.speedMps, 0, Math.cos(rad) * wind.speedMps)
}

/** 按数据装配整个球场：地形、水塘、旗杆、球洞（PLAN.md §2.6 / §4.4） */
export class CourseView {
  readonly group = new THREE.Group()
  readonly terrain: TerrainField
  readonly holes: CourseHole[]

  private readonly flagCloth: THREE.Mesh[] = []
  private readonly geometries: THREE.BufferGeometry[] = []
  private readonly materials: THREE.Material[] = []
  /** 所有水塘共用一张涟漪法线，靠滚动 offset 制造流动感 */
  private readonly waterNormal: THREE.DataTexture

  constructor(readonly spec: CourseSpec) {
    this.terrain = new TerrainField(spec)
    this.holes = spec.holes.map((hole) => ({ spec: hole, wind: windVector(hole.wind) }))

    this.waterNormal = createNormalTexture(128, 3, 77, 1.1)
    this.waterNormal.repeat.set(7, 7)

    const terrainMesh = this.terrain.buildMesh(2)
    this.group.add(terrainMesh)

    for (const pond of this.terrain.ponds) {
      const water = this.createWater(pond.x, pond.z, pond.radius, pond.level)
      this.group.add(water)
    }

    for (const hole of spec.holes) {
      this.group.add(this.createFlagAndCup(hole))
    }
  }

  teePosition(holeIndex: number): THREE.Vector3 {
    const hole = this.holes[Math.min(holeIndex, this.holes.length - 1)]
    const { x, z } = hole.spec.tee
    return new THREE.Vector3(x, this.terrain.heightAt(x, z), z)
  }

  cupPosition(holeIndex: number): THREE.Vector3 {
    const { x, z } = this.holes[Math.min(holeIndex, this.holes.length - 1)].spec.cup
    return new THREE.Vector3(x, this.terrain.heightAt(x, z), z)
  }

  /** 旗布轻微摆动、水面涟漪滚动，给静态场景一点生气 */
  update(time: number): void {
    for (let i = 0; i < this.flagCloth.length; i++) {
      const cloth = this.flagCloth[i]
      cloth.rotation.y = Math.sin(time * 2.2 + i * 1.7) * 0.18
    }
    // 两个方向不同速度，避免看出是同一张贴图在平移
    this.waterNormal.offset.x = time * 0.014
    this.waterNormal.offset.y = time * 0.008
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose()
    for (const material of this.materials) material.dispose()
    this.waterNormal.dispose()
    this.flagCloth.length = 0
  }

  private createWater(x: number, z: number, radius: number, level: number): THREE.Mesh {
    const geometry = new THREE.CircleGeometry(radius, 48)
    geometry.rotateX(-Math.PI / 2)
    const material = new THREE.MeshStandardMaterial({
      color: 0x2f7d9c,
      roughness: 0.08,
      metalness: 0.25,
      transparent: true,
      opacity: 0.88,
      envMapIntensity: 1.4,
      normalMap: this.waterNormal,
      normalScale: new THREE.Vector2(0.5, 0.5),
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, level, z)
    mesh.receiveShadow = true
    mesh.name = 'water'
    this.geometries.push(geometry)
    this.materials.push(material)
    return mesh
  }

  private createFlagAndCup(hole: HoleSpec): THREE.Group {
    const group = new THREE.Group()
    const groundY = this.terrain.heightAt(hole.cup.x, hole.cup.z)

    // 洞：一个深色圆片，看起来像洞口
    const cupGeometry = new THREE.CircleGeometry(0.11, 24)
    cupGeometry.rotateX(-Math.PI / 2)
    const cupMaterial = new THREE.MeshBasicMaterial({ color: 0x11160f })
    const cup = new THREE.Mesh(cupGeometry, cupMaterial)
    cup.position.set(hole.cup.x, groundY + 0.012, hole.cup.z)
    group.add(cup)

    // 旗杆。0.03 而不是真实的 0.011：115m 外 2cm 的杆子在 1080p 上只有 0.5px，
    // 会被抗锯齿直接抹掉，玩家只能看见一个红点却找不到"杆"。
    const poleGeometry = new THREE.CylinderGeometry(0.03, 0.03, 2.6, 8)
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.5, metalness: 0.2 })
    const pole = new THREE.Mesh(poleGeometry, poleMaterial)
    pole.position.set(hole.cup.x, groundY + 1.3, hole.cup.z)
    pole.castShadow = true
    group.add(pole)

    // 旗布放大到 0.8×0.5：100m 外约 9px 宽，是唯一能在远距离辨认出球洞的东西
    const clothGeometry = new THREE.PlaneGeometry(0.8, 0.5, 6, 2)
    clothGeometry.translate(0.4, 0, 0)
    const clothMaterial = new THREE.MeshStandardMaterial({
      color: 0xd8443c,
      roughness: 0.85,
      side: THREE.DoubleSide,
    })
    const cloth = new THREE.Mesh(clothGeometry, clothMaterial)
    cloth.position.set(hole.cup.x + 0.02, groundY + 2.3, hole.cup.z)
    cloth.castShadow = true
    group.add(cloth)

    this.flagCloth.push(cloth)
    this.geometries.push(cupGeometry, poleGeometry, clothGeometry)
    this.materials.push(cupMaterial, poleMaterial, clothMaterial)

    return group
  }
}
