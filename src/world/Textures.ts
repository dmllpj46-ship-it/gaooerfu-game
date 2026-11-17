import * as THREE from 'three'

/**
 * 程序化纹理：零二进制资产，运行时用 JS 生成。
 *
 * 为什么不用 Canvas 2D：DataTexture 不依赖 document，生成完直接上传 GPU，
 * 也不用担心 canvas 的 sRGB 转换把法线图搞错（法线必须是线性空间）。
 *
 * 所有噪声都是**可平铺**的：格点数取 2 的幂并用取模环绕采样，
 * 这样地形用世界坐标做 UV 时不会出现接缝。
 */

/** 固定种子，保证每次启动生成的贴图完全一致（调试截图可比对） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 单层可平铺 value noise，cells 必须整除 size */
function tileableValueNoise(size: number, cells: number, rand: () => number): Float32Array {
  const grid = new Float32Array(cells * cells)
  for (let i = 0; i < grid.length; i++) grid[i] = rand()

  const out = new Float32Array(size * size)
  const scale = cells / size
  for (let y = 0; y < size; y++) {
    const fy = y * scale
    const y0 = Math.floor(fy) % cells
    const y1 = (y0 + 1) % cells
    const ty = fy - Math.floor(fy)
    const sy = ty * ty * (3 - 2 * ty)

    for (let x = 0; x < size; x++) {
      const fx = x * scale
      const x0 = Math.floor(fx) % cells
      const x1 = (x0 + 1) % cells
      const tx = fx - Math.floor(fx)
      const sx = tx * tx * (3 - 2 * tx)

      const top = grid[y0 * cells + x0] + (grid[y0 * cells + x1] - grid[y0 * cells + x0]) * sx
      const bottom = grid[y1 * cells + x0] + (grid[y1 * cells + x1] - grid[y1 * cells + x0]) * sx
      out[y * size + x] = top + (bottom - top) * sy
    }
  }
  return out
}

/** 多八度叠加，返回 0..1 的高度场 */
export function createFbmHeight(size: number, octaves: number, seed: number): Float32Array {
  const rand = mulberry32(seed)
  const out = new Float32Array(size * size)
  let amplitude = 1
  let total = 0
  let cells = 4

  for (let o = 0; o < octaves; o++) {
    const layer = tileableValueNoise(size, cells, rand)
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * amplitude
    total += amplitude
    amplitude *= 0.5
    cells *= 2
  }

  for (let i = 0; i < out.length; i++) out[i] /= total
  return out
}

/**
 * 由高度场生成切线空间法线贴图。
 * strength 控制起伏强度：0.5 像丝绸，4 像碎石路面。
 */
export function createNormalTexture(
  size = 256,
  octaves = 4,
  seed = 1337,
  strength = 2.4,
): THREE.DataTexture {
  const height = createFbmHeight(size, octaves, seed)
  const data = new Uint8Array(size * size * 4)

  // 环绕采样，保证平铺边界上的梯度也是连续的
  const at = (x: number, y: number): number =>
    height[((y + size) % size) * size + ((x + size) % size)]

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength

      let nx = -dx
      let ny = -dy
      let nz = 1
      const len = Math.hypot(nx, ny, nz)
      nx /= len
      ny /= len
      nz /= len

      const i = (y * size + x) * 4
      data[i] = Math.round((nx * 0.5 + 0.5) * 255)
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255)
      data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255)
      data[i + 3] = 255
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  // DataTexture 默认是 Nearest，必须显式改成线性 + mipmap，否则远处会闪
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}

/**
 * 灰度噪声，既当 roughnessMap 也当 map 用。
 * lo/hi 控制取值范围 —— roughnessMap 是**乘**在 material.roughness 上的，
 * 给满 0–1 会让整片地形突然变半光泽，像打了蜡，所以默认压到 0.68–1.0。
 */
export function createNoiseTexture(
  size = 256,
  octaves = 3,
  seed = 91,
  lo = 0.68,
  hi = 1,
): THREE.DataTexture {
  const height = createFbmHeight(size, octaves, seed)
  const data = new Uint8Array(size * size * 4)
  for (let i = 0; i < height.length; i++) {
    const v = Math.round((lo + height[i] * (hi - lo)) * 255)
    const p = i * 4
    data[p] = v
    data[p + 1] = v
    data[p + 2] = v
    data[p + 3] = 255
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}
