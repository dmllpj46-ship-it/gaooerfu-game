import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js'
import { settings } from '../core/Settings'

export interface RendererView {
  readonly renderer: THREE.WebGLRenderer
  render(): void
  resize(): void
  dispose(): void
}

/**
 * 渲染器装配：ACES 色调映射、阴影、可选泛光后期。
 * 低画质（移动端）直接 renderer.render，省掉两个全屏 pass。
 */
export function createRenderer(
  canvas: HTMLCanvasElement,
  maxPixelRatio: number,
  scene: THREE.Scene,
  camera: THREE.Camera,
): RendererView {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  })

  renderer.toneMapping = THREE.ACESFilmicToneMapping
  // 0.94 而不是 1.05：草地本来就偏亮，高曝光会把中间调推到肩部，绿色全变灰白
  renderer.toneMappingExposure = 0.94
  renderer.shadowMap.enabled = true
  // 后处理会在一帧内跑多个 pass：关掉自动重置，自己每帧清零，
  // 这样调试芯片上的 draw call / 三角面才是整帧真实值，而不是最后一个全屏 quad。
  renderer.info.autoReset = false
  // three r186 起 PCFSoftShadowMap 已弃用（内部等价降级），直接使用 PCFShadowMap
  renderer.shadowMap.type = THREE.PCFShadowMap

  let composer: EffectComposer | null = null
  if (settings.postProcessing) {
    const initialWidth = canvas.clientWidth || window.innerWidth
    const initialHeight = canvas.clientHeight || window.innerHeight

    composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))

    // GTAO 必须在 RenderPass 之后、Bloom 之前：它要读场景的深度与法线，
    // 而且遮蔽要在泛光之前算，否则球底下那圈暗部会被辉光抹平。
    if (settings.ambientOcclusion) {
      const gtao = new GTAOPass(scene, camera, initialWidth, initialHeight)
      gtao.output = GTAOPass.OUTPUT.Default
      gtao.blendIntensity = 0.75
      gtao.updateGtaoMaterial({
        // 0.28m：只抓角色/球/旗杆贴地那一圈。半径给到 0.55 时，
        // 稀疏的草叶会互相遮蔽，整片球道被压成暗绿，反而更假。
        radius: 0.28,
        distanceExponent: 1,
        thickness: 1.2,
        scale: 1,
        samples: 8, // 默认 16，8 在集显上省一半且几乎看不出差别
      })
      composer.addPass(gtao)
    }

    // 只让天空与高光溢出一点点，避免整屏发灰；阈值抬高，草地不该参与泛光
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.55, 0.96))
    composer.addPass(new OutputPass())

    // SMAA 放在 OutputPass 之后：色调映射和 sRGB 编码都做完了，
    // 边缘检测才在正确的色彩空间里，放在之前会把高光边缘判错。
    // 0.187 的 SMAAPass 构造函数不收尺寸，靠 composer.setSize 统一调整。
    composer.addPass(new SMAAPass())
  }

  const resize = (): void => {
    const width = canvas.clientWidth || window.innerWidth
    const height = canvas.clientHeight || window.innerHeight
    const pixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio)
    renderer.setPixelRatio(pixelRatio)
    // updateStyle=false：画布尺寸由 CSS 的 100vw/100vh 决定
    renderer.setSize(width, height, false)
    composer?.setPixelRatio(pixelRatio)
    composer?.setSize(width, height)
  }

  resize()

  return {
    renderer,
    render: () => {
      renderer.info.reset()
      if (composer) composer.render()
      else renderer.render(scene, camera)
    },
    resize,
    dispose(): void {
      composer?.dispose()
      composer = null
      renderer.dispose()
    },
  }
}
