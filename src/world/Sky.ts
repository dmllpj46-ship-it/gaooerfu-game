import * as THREE from 'three'

/**
 * 三通道渐变天穹 + 太阳光晕，并据此生成 PMREM 环境贴图。
 *
 * 为什么 M0 不用 three 的 Sky addon：这里只有几行 shader，零体积、零 examples 依赖，
 * 且天空颜色与雾色共用一份色板；M5 做美术时再按 PLAN.md §5 评估换成 Preetham Sky。
 * 天空是直接写给屏幕的颜色，所以色值走 LinearSRGB 直通（不做 sRGB→linear 转换）。
 *
 * 色板取值的理由：越肩机位的视线几乎水平，屏幕上大部分天空落在 horizon 附近，
 * 所以 horizon 必须自带蓝相，否则整个上半屏会糊成灰白。zenith 加深是为了让
 * 抬头时仍有层次，不至于天地一个色。
 */
export const SKY_COLORS = {
  zenith: 0x1b5aa6,
  horizon: 0x9dc2e2,
  // ground 必须和 horizon 同色：地平线以下那一圈原本会露出一条深绿带，
  // 和雾色对不上，看起来像地平线上压了一道黑边。
  ground: 0x9dc2e2,
  sun: 0xfff1cf,
  // 云不能纯白：线性直通下 0xffffff 会在泛光里烧成一块光斑
  cloud: 0xdde8ee,
} as const

const SUN_ELEVATION_DEG = 26
const SUN_AZIMUTH_DEG = 138

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vDirection;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    // 天穹球心每帧跟随相机，因此世界位置差就是视线方向
    vDirection = worldPosition.xyz - cameraPosition;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunColor;
  uniform vec3 uSunDirection;
  uniform vec3 uCloudColor;
  uniform float uTime;

  varying vec3 vDirection;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  // 2 个八度封顶：天空是 depthTest:false 的全屏 pass，每多一个八度就多 4 次 hash，
  // 3 个八度实测把帧率从 60 打到 26 —— 云只是背景，不值得这个代价。
  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 2; i++) {
      value += amplitude * valueNoise(p);
      p *= 2.07;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec3 dir = normalize(vDirection);
    float h = clamp(dir.y, -1.0, 1.0);

    // 指数 0.4（原 0.55）：越肩机位的视线很平，指数太高的话蓝只在抬头时才出现，
    // 屏幕上半部会一直是一片灰。压到 0.4 让中低仰角也带蓝。
    vec3 sky = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.4));
    sky = mix(sky, uGround, smoothstep(0.0, -0.3, h));

    // 云：把视线方向投影到 y=1 的平面上做 fbm，自然形成近大远小的透视。
    // 除以 max(h, 0.06) 是关键 —— 否则贴近地平线时 uv 会炸到无穷大。
    if (h > 0.0) {
      vec2 cloudUv = dir.xz / max(h, 0.06) * 0.55;
      float drift = uTime * 0.006;
      float base = fbm(cloudUv + vec2(drift, drift * 0.4));
      float density = smoothstep(0.4, 0.62, base);
      // 地平线附近压淡，远处才不会糊成一条白边
      density *= smoothstep(0.02, 0.2, h);
      sky = mix(sky, uCloudColor, density * 0.9);
    }

    float sun = max(dot(dir, normalize(uSunDirection)), 0.0);
    sky += uSunColor * pow(sun, 320.0) * 5.0; // 日面
    // 光晕只留一点点：原来的 0.2 会把整个水平视野洗白，草地也跟着发灰
    sky += uSunColor * pow(sun, 24.0) * 0.12;

    gl_FragColor = vec4(sky, 1.0);
  }
`

export interface SkyView {
  readonly sunDirection: THREE.Vector3
  readonly sunLight: THREE.DirectionalLight
  /** 每帧调用：让天穹跟着相机走（避免走到边界穿帮），并推进云的漂移 */
  update(camera: THREE.Camera, time: number): void
  dispose(): void
}

function displayColor(hex: number): THREE.Color {
  return new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace)
}

function createSkyMaterial(sunDirection: THREE.Vector3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: displayColor(SKY_COLORS.zenith) },
      uHorizon: { value: displayColor(SKY_COLORS.horizon) },
      uGround: { value: displayColor(SKY_COLORS.ground) },
      uSunColor: { value: displayColor(SKY_COLORS.sun) },
      uSunDirection: { value: sunDirection.clone() },
      uCloudColor: { value: displayColor(SKY_COLORS.cloud) },
      uTime: { value: 0 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  })
}

export function createSky(scene: THREE.Scene, renderer: THREE.WebGLRenderer): SkyView {
  const sunDirection = new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - SUN_ELEVATION_DEG),
    THREE.MathUtils.degToRad(SUN_AZIMUTH_DEG),
  )

  // 半径为 1 的球，靠 scale 撑成天穹；shader 只看方向，尺寸可任意
  const geometry = new THREE.SphereGeometry(1, 32, 16)
  const material = createSkyMaterial(sunDirection)

  const sky = new THREE.Mesh(geometry, material)
  sky.scale.setScalar(1000)
  sky.renderOrder = -1
  sky.frustumCulled = false
  sky.name = 'sky'
  scene.add(sky)

  // 用同一份天空生成 PMREM 环境贴图：球的清漆、球杆金属都会反射到这里
  const pmrem = new THREE.PMREMGenerator(renderer)
  const envScene = new THREE.Scene()
  const envSky = new THREE.Mesh(geometry, createSkyMaterial(sunDirection))
  envSky.scale.setScalar(50)
  envSky.frustumCulled = false
  envScene.add(envSky)
  const envTarget = pmrem.fromScene(envScene, 0.04)
  pmrem.dispose()
  envSky.material.dispose()
  envScene.clear()

  scene.environment = envTarget.texture
  // 环境光压低：3.2 的平行光 + 0.9 的环境光会把白 polo 直接打到过曝，
  // 角色只剩一片白、看不出体积。0.5 让背光面留得住暗部。
  scene.environmentIntensity = 0.5

  // 太阳平行光 + 阴影（M0 只覆盖球附近的 ±22m，够看清球的投影）
  const sunLight = new THREE.DirectionalLight(0xfff3de, 2.6)
  sunLight.position.copy(sunDirection).multiplyScalar(120)
  sunLight.castShadow = true
  sunLight.shadow.mapSize.set(2048, 2048)
  sunLight.shadow.camera.near = 1
  sunLight.shadow.camera.far = 320
  sunLight.shadow.camera.left = -22
  sunLight.shadow.camera.right = 22
  sunLight.shadow.camera.top = 22
  sunLight.shadow.camera.bottom = -22
  sunLight.shadow.camera.updateProjectionMatrix()
  sunLight.shadow.bias = -0.0004
  sunLight.shadow.normalBias = 0.02
  sunLight.name = 'sun'
  scene.add(sunLight)
  scene.add(sunLight.target)

  return {
    sunDirection,
    sunLight,
    update(camera: THREE.Camera, time: number): void {
      sky.position.copy(camera.position)
      material.uniforms.uTime.value = time
    },
    dispose(): void {
      scene.remove(sky, sunLight, sunLight.target)
      scene.environment = null
      geometry.dispose()
      material.dispose()
      envTarget.dispose()
    },
  }
}
