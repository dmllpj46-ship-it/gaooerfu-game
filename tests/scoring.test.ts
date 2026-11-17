import { describe, expect, it } from 'vitest'
import { formatRelative, relativeToPar, scoreName, totalPar, totalStrokes } from '../src/game/Scoring'

describe('计分命名', () => {
  it('按杆差给出名称', () => {
    expect(scoreName(2, 3)).toBe('小鸟')
    expect(scoreName(3, 3)).toBe('标准杆')
    expect(scoreName(4, 3)).toBe('柏忌')
    expect(scoreName(5, 3)).toBe('双柏忌')
    expect(scoreName(1, 4)).toBe('一杆进洞')
    expect(scoreName(7, 3)).toBe('+4')
  })
})

describe('总成绩', () => {
  const results = [
    { par: 3, strokes: 2 },
    { par: 4, strokes: 5 },
    { par: 5, strokes: 5 },
  ]

  it('总杆数与标准杆正确', () => {
    expect(totalStrokes(results)).toBe(12)
    expect(totalPar(results)).toBe(12)
    expect(relativeToPar(results)).toBe(0)
  })

  it('相对标准杆格式化', () => {
    expect(formatRelative(0)).toBe('E')
    expect(formatRelative(3)).toBe('+3')
    expect(formatRelative(-2)).toBe('-2')
  })
})
