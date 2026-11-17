/** 计分（纯函数，可单测）。 */

export interface HoleResult {
  readonly par: number
  readonly strokes: number
}

export function scoreName(strokes: number, par: number): string {
  if (strokes === 1) return '一杆进洞'
  const diff = strokes - par
  switch (diff) {
    case -3:
      return '信天翁'
    case -2:
      return '老鹰'
    case -1:
      return '小鸟'
    case 0:
      return '标准杆'
    case 1:
      return '柏忌'
    case 2:
      return '双柏忌'
    default:
      return diff > 0 ? `+${diff}` : `${diff}`
  }
}

export function totalStrokes(results: readonly HoleResult[]): number {
  return results.reduce((sum, result) => sum + result.strokes, 0)
}

export function totalPar(results: readonly HoleResult[]): number {
  return results.reduce((sum, result) => sum + result.par, 0)
}

export function relativeToPar(results: readonly HoleResult[]): number {
  return totalStrokes(results) - totalPar(results)
}

export function formatRelative(relative: number): string {
  if (relative === 0) return 'E'
  return relative > 0 ? `+${relative}` : `${relative}`
}
