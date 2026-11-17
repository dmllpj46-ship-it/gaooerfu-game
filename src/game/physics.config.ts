/**
 * 所有手感常量集中在这里（AGENTS.md 不变量 5）。
 * 调参后请跑 `npm test`，PLAN.md §7 M2 的验收依赖这些数字。
 */

export const GRAVITY_MPS2 = 9.81

export const AIR_DENSITY_KG_M3 = 1.2
export const BALL_RADIUS_M = 0.02135
export const BALL_MASS_KG = 0.0459
export const BALL_AREA_M2 = Math.PI * BALL_RADIUS_M ** 2

/** 凹坑球近似阻力系数 */
export const DRAG_COEFF = 0.27
/** 自旋比 S = ω·r / v 越大阻力越小（凹坑球在旋转时尾流变窄） */
export const DRAG_SPIN_REDUCTION = 0.05
/**
 * 升力模型：Cl = min(MAX_LIFT_COEFF, LIFT_COEFF_PER_SPIN_RATIO · S)
 * 力沿 ω̂ × v̂（垂直于速度），这是高尔夫弹道仿真的标准写法：
 * 直接把马格努斯写成 k(ω × v) 会在高后旋/低速时产生虚假的向后分量，
 * 把挖起杆的球"顶"停在半空（第一版就是这样，wedge 只飞了 40m）。
 */
export const LIFT_COEFF_PER_SPIN_RATIO = 1.9
export const MAX_LIFT_COEFF = 0.42
/** 空中后旋衰减（1/s） */
export const SPIN_DECAY_PER_S = 0.35

/** 固定物理步长：1/240s（AGENTS.md 不变量 2） */
export const FIXED_STEP_S = 1 / 240
export const MAX_SUBSTEPS = 8

/** 低于这个速度且贴地即判定静止 */
export const REST_SPEED_MPS = 0.07
/** 法向速度低于此值不再弹起，转为贴地滚动 */
export const BOUNCE_SPEED_MPS = 0.45

export const CUP_RADIUS_M = 0.054
/** 进洞的最大速度，超过就是"擦洞而出" */
export const CUP_MAX_SPEED_MPS = 4.5

export const MAX_BALL_SPEED_MPS = 120

/** 球与地面接触的判定容差（米） */
export const CONTACT_EPSILON_M = 0.002
