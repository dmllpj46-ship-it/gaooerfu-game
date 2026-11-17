import * as THREE from 'three'
import type { TerrainField } from './Terrain'
import { Surface } from './Surfaces'

/**
 * 界外远景树线：把笔直的地平线打散，给球场一点纵深。
 *
 * 只种在 Surface.Out 上，球道/果岭/水塘自动避开（靠同一份面层掩码，不另写一套规则）。
 * 两棵 InstancedMesh 一共 2 个 draw call；没有碰撞 —— 树全在界外，
 * 球飞过去本来就判 +1 罚杆，穿模不影响玩法。
 * 造型压得很低（3–6 m）并偏冷绿，远处会被雾吃掉一半，看起来像球场外围的防风林。
 */
export class Treeline {
  readonly group = new THREE.Group()
  private readonly geometries: THREE.BufferGeometry[] = []
  private readonly materials: THREE.Material[] = []
  private readonly trunkMesh: THREE.InstancedMesh
  private readonly crownMesh: THREE.InstancedMesh

  constructor(scene: THREE.Scene, terrain: TerrainField, count = 260) {
    const trunkGeometry = new THREE.CylinderGeometry(0.16, 0.26, 1, 5)
    trunkGeometry.translate(0, 0.5, 0)
    const crownGeometry = new THREE.ConeGeometry(1, 1, 6)
    crownGeometry.translate(0, 0.5, 0)

    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.92 })
    const crownMaterial = new THREE.MeshStandardMaterial({ color: 0x2d5230, roughness: 0.88 })

    this.trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, count)
    this.crownMesh = new THREE.InstancedMesh(crownGeometry, crownMaterial, count)
    for (const mesh of [this.trunkMesh, this.crownMesh]) {
      mesh.frustumCulled = false
      mesh.castShadow = false
      mesh.receiveShadow = false
    }
    this.trunkMesh.name = 'treeline-trunks'
    this.crownMesh.name = 'treeline-crowns'

    this.place(terrain, count)

    this.group.add(this.trunkMesh, this.crownMesh)
    scene.add(this.group)

    this.geometries.push(trunkGeometry, crownGeometry)
    this.materials.push(trunkMaterial, crownMaterial)
  }

  private place(terrain: TerrainField, count: number): void {
    const dummy = new THREE.Object3D()
    const spanX = terrain.maxX - terrain.minX
    const spanZ = terrain.maxZ - terrain.minZ
    let placed = 0
    // 界外只占地形的一部分，随机撒点会大量落空，给个硬上限防死循环
    let guard = 0
    const maxAttempts = count * 60

    while (placed < count && guard < maxAttempts) {
      guard++
      const x = terrain.minX + Math.random() * spanX
      const z = terrain.minZ + Math.random() * spanZ
      if (terrain.layerAt(x, z) !== Surface.Out) continue

      const y = terrain.heightAt(x, z)
      const size = 0.75 + Math.random() * 0.85
      const trunkHeight = 1.1 * size
      const crownHeight = (2.6 + Math.random() * 1.9) * size
      const crownWidth = (1.0 + Math.random() * 0.55) * size
      const spin = Math.random() * Math.PI * 2

      dummy.position.set(x, y, z)
      dummy.rotation.set(0, spin, 0)
      dummy.scale.set(crownWidth, trunkHeight, crownWidth)
      dummy.updateMatrix()
      this.trunkMesh.setMatrixAt(placed, dummy.matrix)

      dummy.position.set(x, y + trunkHeight * 0.8, z)
      dummy.scale.set(crownWidth, crownHeight, crownWidth)
      dummy.updateMatrix()
      this.crownMesh.setMatrixAt(placed, dummy.matrix)

      placed++
    }

    // 没撒满的位置塞到地下，避免默认矩阵在原点叠出一棵"树"
    for (let i = placed; i < count; i++) {
      dummy.position.set(0, -200, 0)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.setScalar(0.001)
      dummy.updateMatrix()
      this.trunkMesh.setMatrixAt(i, dummy.matrix)
      this.crownMesh.setMatrixAt(i, dummy.matrix)
    }

    this.trunkMesh.instanceMatrix.needsUpdate = true
    this.crownMesh.instanceMatrix.needsUpdate = true
  }

  dispose(): void {
    this.group.removeFromParent()
    for (const geometry of this.geometries) geometry.dispose()
    for (const material of this.materials) material.dispose()
    this.trunkMesh.dispose()
    this.crownMesh.dispose()
  }
}
