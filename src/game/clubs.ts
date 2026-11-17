/** 球杆表（PLAN.md §2.2）。数值改动后必须跑 `npm test` 复核落点。 */

export type ClubId = 'driver' | 'iron7' | 'wedge' | 'putter'

export interface Club {
  readonly id: ClubId
  readonly name: string
  readonly shortName: string
  /** 满力初速 m/s */
  readonly maxSpeedMps: number
  readonly launchAngleDeg: number
  readonly spinRpm: number
  /** 力度→初速的非线性指数，<1 让中低力度更可控 */
  readonly powerCurve: number
}

export const CLUBS: readonly Club[] = [
  {
    id: 'driver',
    name: '一号木',
    shortName: '1W',
    maxSpeedMps: 73,
    launchAngleDeg: 12,
    spinRpm: 2700,
    powerCurve: 0.85,
  },
  {
    id: 'iron7',
    name: '七号铁',
    shortName: '7i',
    maxSpeedMps: 48,
    launchAngleDeg: 22,
    spinRpm: 6200,
    powerCurve: 0.85,
  },
  {
    id: 'wedge',
    name: '挖起杆',
    shortName: 'SW',
    maxSpeedMps: 32,
    launchAngleDeg: 42,
    spinRpm: 9000,
    powerCurve: 0.9,
  },
  {
    id: 'putter',
    name: '推杆',
    shortName: 'PT',
    maxSpeedMps: 9,
    launchAngleDeg: 0,
    spinRpm: 0,
    powerCurve: 1,
  },
]

export function clubById(id: ClubId): Club {
  const club = CLUBS.find((candidate) => candidate.id === id)
  if (!club) throw new Error(`未知球杆：${id}`)
  return club
}

/** 力度（0–1）→ 初速（m/s） */
export function launchSpeed(club: Club, power: number): number {
  const clamped = Math.min(1, Math.max(0, power))
  return club.maxSpeedMps * Math.pow(clamped, club.powerCurve)
}
