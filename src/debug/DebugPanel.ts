import type * as THREE from 'three'

export interface StatsChip {
  update(dt: number, renderer: THREE.WebGLRenderer): void
  dispose(): void
}

/**
 * 角落帧率芯片（PLAN.md M0 验收项）。
 * ?debug=1 时额外显示 draw call 与三角面数；采样窗口 0.5s，避免数字乱跳。
 */
export function createStatsChip(debug: boolean): StatsChip {
  const element = document.createElement('div')
  element.className = 'stats-chip'
  element.setAttribute('aria-hidden', 'true')
  document.body.appendChild(element)

  const SAMPLE_WINDOW_S = 0.5
  let frames = 0
  let elapsed = 0
  let fps = 0

  return {
    update(dt: number, renderer: THREE.WebGLRenderer): void {
      frames += 1
      elapsed += dt
      if (elapsed < SAMPLE_WINDOW_S) return

      fps = Math.round(frames / elapsed)
      frames = 0
      elapsed = 0

      const info = renderer.info.render
      element.textContent = debug
        ? `${fps} fps · ${info.calls} calls · ${(info.triangles / 1000).toFixed(1)}k tris`
        : `${fps} fps`
    },
    dispose(): void {
      element.remove()
    },
  }
}
