import type { CourseHole, CourseView } from '../world/Course'
import type { HoleResult } from './Scoring'

/** 一局的洞位推进与杆数记录（很薄，所有判定仍在 Game 里） */
export class Round {
  private index = 0
  private strokes = 0
  readonly results: HoleResult[] = []

  constructor(private readonly course: CourseView) {}

  get holeIndex(): number {
    return this.index
  }

  get hole(): CourseHole {
    return this.course.holes[Math.min(this.index, this.course.holes.length - 1)]
  }

  get holeNumber(): number {
    return this.hole.spec.index
  }

  get holeCount(): number {
    return this.course.holes.length
  }

  get par(): number {
    return this.hole.spec.par
  }

  get strokeCount(): number {
    return this.strokes
  }

  get isComplete(): boolean {
    return this.results.length >= this.course.holes.length
  }

  get nextPar(): number {
    const next = this.course.holes[Math.min(this.index + 1, this.course.holes.length - 1)]
    return next.spec.par
  }

  addStroke(): void {
    this.strokes += 1
  }

  addPenalty(): void {
    this.strokes += 1
  }

  /** 记录当前洞的杆数并前进到下一洞 */
  finishHole(): HoleResult {
    const result: HoleResult = { par: this.par, strokes: this.strokes }
    this.results.push(result)
    this.index += 1
    this.strokes = 0
    return result
  }

  reset(): void {
    this.index = 0
    this.strokes = 0
    this.results.length = 0
  }
}
