/** 球场/洞位的数据结构。关卡是纯数据，场景构建与物理都只读这些字段（AGENTS.md 不变量 6）。 */

export interface Vec2 {
  readonly x: number
  readonly z: number
}

export interface CircleSpec extends Vec2 {
  readonly radius: number
}

export interface HoleSpec {
  readonly index: number
  readonly par: number
  readonly tee: Vec2
  readonly cup: Vec2
  readonly greenRadius: number
  readonly fairwayWidth: number
  readonly bunkers: readonly CircleSpec[]
  readonly ponds: readonly CircleSpec[]
  readonly wind: { readonly speedMps: number; readonly dirDeg: number }
}

export interface CourseSpec {
  readonly name: string
  readonly bounds: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }
  readonly holes: readonly HoleSpec[]
}
