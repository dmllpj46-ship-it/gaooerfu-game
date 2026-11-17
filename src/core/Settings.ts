/** 启动时读一次 URL 与设备信息决定的运行时设置（PLAN.md §4.1 core/Settings）。 */

const params = new URLSearchParams(window.location.search)

/** 移动端直接关掉全屏后期，省两个 pass 的带宽 */
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)

/**
 * 像素比上限 1.5（原 2）。DPR 2 的屏幕按 2 倍渲染意味着 4 倍像素，
 * 实测在 Intel 集显上直接把帧时间翻倍，而 1.5 和 2 的肉眼差别很小。
 */
const maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5)

/**
 * GTAO 的像素预算。它要多跑一遍法线/深度 + 一次 AO + 一次降噪，
 * 实测（Intel 集显，readPixels 同步计时）：
 *   135 万像素 17.6ms / 192 万像素 21.3ms / 1050 万像素 34.6ms。
 * 466 万像素（1080p @ DPR1.5）估算 ~25ms ≈ 39fps，低于 55 的目标，
 * 所以超过这个预算就自动把 AO 关掉，宁可少一层遮蔽也不要掉帧。
 */
const pixelBudget = window.innerWidth * window.innerHeight * maxPixelRatio * maxPixelRatio
const AO_PIXEL_BUDGET = 2_600_000

/**
 * ?ao=1 强制开、?ao=0 强制关，用于 A/B 测帧时间；不给参数就按像素预算自动决定。
 * 强制开存在的意义：把自动降级打开后，线上复现不到「AO 很贵」这个现场，
 * 有个开关才能在同分辨率下对比开/关的差值。
 */
const aoParam = params.get('ao')

export const settings = {
  /** ?debug=1：显示 draw call / 三角面等调试信息 */
  debug: params.get('debug') === '1',
  maxPixelRatio,
  /** 泛光后期（移动端关闭） */
  postProcessing: !isMobile,
  /** 环境光遮蔽：移动端关；超出像素预算关；?ao=1 强制开、?ao=0 强制关 */
  ambientOcclusion:
    !isMobile && aoParam !== '0' && (aoParam === '1' || pixelBudget < AO_PIXEL_BUDGET),
} as const
