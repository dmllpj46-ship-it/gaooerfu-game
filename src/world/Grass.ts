import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { TerrainField } from './Terrain'
import { Surface } from './Surfaces'

/**
 * 草丛：单 draw call 的 InstancedMesh，只在当前洞附近铺一层。
 * 每洞开始重新 scatter 到球附近，避免为 1km 长的球场铺满草。
 */
export class Grass {
  readonly mesh: THREE.InstancedMesh
  private readonly dummy = new THREE.Object3D()
  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.MeshStandardMaterial
  private readonly count: number
  private readonly tint = new THREE.Color()
  /** 风摆时间，每帧由 Game 推进；用对象包着是为了能塞进 shader.uniforms */
  private readonly windTime = { value: 0 }

  constructor(scene: THREE.Scene, private readonly terrain: TerrainField, count = 3200) {
    this.count = count
    // 交叉双面片而不是单片：单片草叶俯视时正好侧对镜头，几乎看不见，
    // 只剩远处零星几根竖条，看起来像地上的碎屑。十字交叉从任何角度都有面。
    const plane = new THREE.PlaneGeometry(0.058, 0.19)
    plane.translate(0, 0.095, 0)
    const crossed = plane.clone()
    crossed.rotateY(Math.PI / 2)
    this.geometry = mergeGeometries([plane, crossed])
    plane.dispose()
    crossed.dispose()
    this.material = new THREE.MeshStandardMaterial({
      // 比球道色（0x51973e）略亮一点点。原来用 0x477f33 比球道暗，
      // 一排排深色叶片压在亮绿球道上，读起来是"散落的棍子"而不是草。
      color: 0x5f9c47,
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
    })
    this.applyWind()

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, count)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.castShadow = false
    this.mesh.receiveShadow = false
    this.mesh.name = 'grass'
    scene.add(this.mesh)
  }

  /**
   * 顶点风摆。用 onBeforeCompile 注入而不是自己写 ShaderMaterial ——
   * 这样还能白拿 MeshStandardMaterial 的光照、雾、环境贴图，换 ShaderMaterial 得全重写。
   */
  private applyWind(): void {
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = this.windTime
      shader.vertexShader =
        'uniform float uWindTime;\n' +
        shader.vertexShader
          .replace(
            '#include <beginnormal_vertex>',
            /* glsl */ `
            #include <beginnormal_vertex>
            // 法线强制朝上，让草叶和它脚下的地面受光完全一致。
            // 竖着的面片法线朝侧面，太阳在头顶时只有很暗的掠射光 ——
            // 这就是"草比球道暗一大截、看起来像散落的深绿小棍"的根因。
            // 真实的草叶卡片也是这么干的：它不该有自己的体积感。
            objectNormal = vec3(0.0, 1.0, 0.0);
            `,
          )
          .replace(
            '#include <begin_vertex>',
            /* glsl */ `
            #include <begin_vertex>
            // 本地 y 从 0（根）到 0.19（尖）；平方后根部几乎不动，只有叶尖摆
            float sway = clamp(transformed.y * 5.2, 0.0, 1.0);
            sway *= sway;
            // 相位取自每株草的世界位置，整片才会像波浪推过去，而不是齐步走
            vec3 bladeOrigin = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            float phase = bladeOrigin.x * 0.32 + bladeOrigin.z * 0.24;
            transformed.x += sin(uWindTime * 1.7 + phase) * 0.055 * sway;
            transformed.z += cos(uWindTime * 1.3 + phase * 1.4) * 0.038 * sway;
            `,
          )
    }
    // 改过 shader 源码就必须给稳定的 cache key，
    // 否则 three 可能把它和别的 MeshStandardMaterial 共用一份编译结果
    this.material.customProgramCacheKey = () => 'grass-wind'
  }

  /** 每帧推进风的时间；草叶的摆动完全在 GPU 上算，CPU 只更新这一个 float */
  update(time: number): void {
    this.windTime.value = time
  }

  /** 在 (centerX, centerZ) 半径 radius 内重新撒一遍草 */
  scatter(centerX: number, centerZ: number, radius = 22): void {
    for (let i = 0; i < this.count; i++) {
      // 环形分布：靠近球的地方更密
      const angle = Math.random() * Math.PI * 2
      const distance = Math.sqrt(Math.random()) * radius
      const x = centerX + Math.cos(angle) * distance
      const z = centerZ + Math.sin(angle) * distance
      const layer = this.terrain.layerAt(x, z)

      // 只在长草区铺草。球道是剪到 1cm 的草坪，真实球道上根本看不见单根草叶；
      // 之前球道也铺了一层 0.38 高的短草，结果就是"光滑草坪上插着一根根竖棍"。
      // 球道的质感交给地形的法线贴图与剪草条纹，草叶只在长草区当簇状细节。
      if (layer !== Surface.Rough) {
        this.dummy.position.set(0, -50, 0)
        this.dummy.scale.setScalar(0.001)
      } else {
        this.dummy.position.set(x, this.terrain.heightAt(x, z) - 0.02, z)
        this.dummy.rotation.set(0, Math.random() * Math.PI, 0)
        const scale = 0.85 + Math.random() * 0.5
        this.dummy.scale.set(scale, scale * (0.9 + Math.random() * 0.4), scale)
      }

      // 每株草亮度 ±18%：整片一个色值会像贴上去的假草皮，有深浅才像草
      const shade = 0.82 + Math.random() * 0.36
      this.tint.setRGB(shade, shade * (0.94 + Math.random() * 0.12), shade)
      this.mesh.setColorAt(i, this.tint)

      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  dispose(): void {
    this.mesh.removeFromParent()
    this.geometry.dispose()
    this.material.dispose()
    this.mesh.dispose()
  }
}
