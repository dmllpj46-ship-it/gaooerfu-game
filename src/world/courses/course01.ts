import type { CourseSpec } from '../CourseTypes'

/**
 * 第一座球场：3 洞，沿 +Z 依次排开。
 * 距离按真实尺度设计（driver ≈ 230m），因此整条球场约 1.1km 长。
 * 洞 1 短三杆洞热身 → 洞 2 标准四杆洞有水中障碍 → 洞 5 杆洞左右各一个沙坑群。
 */
export const course01: CourseSpec = {
  name: 'Seabreeze Links',
  bounds: { minX: -150, maxX: 150, minZ: -70, maxZ: 1080 },
  holes: [
    {
      index: 1,
      par: 3,
      tee: { x: 0, z: 0 },
      cup: { x: 12, z: 148 },
      greenRadius: 13,
      fairwayWidth: 26,
      bunkers: [
        { x: -4, z: 132, radius: 6 },
        { x: 26, z: 146, radius: 5 },
      ],
      ponds: [{ x: -26, z: 74, radius: 11 }],
      wind: { speedMps: 3.5, dirDeg: 205 },
    },
    {
      index: 2,
      par: 4,
      tee: { x: -6, z: 196 },
      cup: { x: 20, z: 520 },
      greenRadius: 14,
      fairwayWidth: 36,
      bunkers: [
        { x: 34, z: 470, radius: 7 },
        { x: -18, z: 392, radius: 6 },
      ],
      ponds: [{ x: 6, z: 306, radius: 13 }],
      wind: { speedMps: 4.2, dirDeg: 150 },
    },
    {
      index: 3,
      par: 5,
      tee: { x: 8, z: 566 },
      cup: { x: -24, z: 1012 },
      greenRadius: 15,
      fairwayWidth: 40,
      bunkers: [
        { x: -42, z: 952, radius: 7 },
        { x: 14, z: 856, radius: 6 },
        { x: -30, z: 700, radius: 5 },
      ],
      ponds: [{ x: -46, z: 738, radius: 15 }],
      wind: { speedMps: 5, dirDeg: 320 },
    },
  ],
}
