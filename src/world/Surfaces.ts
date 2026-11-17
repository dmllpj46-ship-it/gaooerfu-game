/** 面层既是物理参数来源，也是地形顶点色的唯一来源（AGENTS.md 不变量 7）。 */

export const Surface = {
  Fairway: 0,
  Rough: 1,
  Green: 2,
  Bunker: 3,
  Water: 4,
  Out: 5,
} as const

export type SurfaceId = (typeof Surface)[keyof typeof Surface]

export interface SurfaceProps {
  readonly label: string
  /** 法向反弹恢复系数 */
  readonly restitution: number
  /** 滚动摩擦系数（乘 g 得到减速度） */
  readonly rollingFriction: number
  readonly color: number
}

export const SURFACES: Record<SurfaceId, SurfaceProps> = {
  [Surface.Fairway]: { label: '球道', restitution: 0.28, rollingFriction: 0.55, color: 0x51973e },
  [Surface.Rough]: { label: '长草', restitution: 0.1, rollingFriction: 1.1, color: 0x2f5a27 },
  [Surface.Green]: { label: '果岭', restitution: 0.06, rollingFriction: 0.08, color: 0x7ecb57 },
  [Surface.Bunker]: { label: '沙坑', restitution: 0.02, rollingFriction: 2.8, color: 0xd8c396 },
  [Surface.Water]: { label: '水', restitution: 0, rollingFriction: 1, color: 0x24647f },
  [Surface.Out]: { label: '界外', restitution: 0.08, rollingFriction: 1.4, color: 0x2b4526 },
}

export function surfaceLabel(id: number): string {
  return SURFACES[id as SurfaceId]?.label ?? '未知'
}
