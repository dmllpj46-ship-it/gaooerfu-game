import * as THREE from 'three'
import type { Club } from '../game/clubs'
import { BALL_RADIUS_M } from '../game/physics.config'
import { ADDRESS_POSE, type SwingPose } from './SwingAnimator'

/**
 * 程序化生成的女性球手（PLAN.md §6 的占位策略：先用几何体把挥杆跑通，再接 GLTF）。
 *
 * 造型走**卡通比例**而不是写实比例。原因很直接：用几何体拼写实人体，
 * 只要比例差 5% 就会掉进恐怖谷 —— 头太小、四肢太细、没有脸，
 * 远看就是"一个瘦长的肉色怪东西"。卡通化把这几项全部反转：
 * 头放大、四肢变粗、五官夸张，读者一眼就认成"角色"而不是"失败的人"。
 *
 * 层级：root(位置/朝向) → body(绕 Y 扭转 + 前倾) → 躯干/头/手臂 pivot/腿
 */

const SKIN = 0xf2cba8
const SKIN_DEEP = 0xd9a47c
const HAIR = 0x3a2419
// 珊瑚红 polo + 深蓝短裙：球道是大面积绿色，角色必须有一个暖色块才立得出来
const POLO = 0xe8694f
const SKIRT = 0x1f3a63
const SKIRT_DEEP = 0x182e4f
const PANTS = 0xf2f4f2
const SHOE = 0xfbfcfb
const SOLE = 0x2a3038
const EYE = 0x24262e
const MOUTH = 0xa8503f
const CLUB_SHAFT = 0xc3c9cf

/** 手腕铰链的转轴（绕 X，即"把杆头折上去"的方向） */
const WRIST_AXIS = new THREE.Vector3(1, 0, 0)
const DOWN = new THREE.Vector3(0, -1, 0)
const UP = new THREE.Vector3(0, 1, 0)
const Y_AXIS = new THREE.Vector3(0, 1, 0)

// ------------------------------------------------------------------ 骨架尺寸
const HIP_Y = 0.74
const SHOULDER_Y = 1.22
const HEAD_Y = 1.46
/** 头半径 0.166 → 头高 ≈ 身高的 1/4.8（写实是 1/7.5）。卡通感的主要来源：
 * 头一大，四肢自然显得短粗，整个人立刻从"比例失调的人"变成"角色"。
 * 再往上推（1/4 以下）就变成幼儿比例，握杆的手臂会短到够不着地 */
const HEAD_R = 0.166
/** 五官 / 帽子 / 头发全部按头半径等比缩放，以后调头大小只改 HEAD_R 这一个数 */
const K = HEAD_R / 0.15
const SHOULDER_X = 0.17
/** 手臂 pivot 挂在肩线中点 */
const PIVOT_POS = new THREE.Vector3(0, SHOULDER_Y, 0)

/**
 * 站位偏移：角色站在球的左后方。这两个数字同时决定 place() 的位移
 * 和杆身该指向哪里（见 computeAim），改一个另一个必须跟着变 —— 所以提出来共用。
 */
const STAND_OFFSET_RIGHT = 0.34
const STAND_OFFSET_BACK = 0.3

/** 握把在 armPivot 空间里的位置（相对肩线）。z 要推出裙摆，否则手和杆一起被裙子吞掉 */
const GRIP = new THREE.Vector3(0.05, -0.34, 0.17)
/** 肘部：挂在身体两侧、比躯干略宽，从背后才看得见两条上臂 */
const ELBOW_R = new THREE.Vector3(0.196, -0.185, 0.03)
const ELBOW_L = new THREE.Vector3(-0.196, -0.185, 0.03)

export class Golfer {
  readonly group = new THREE.Group()

  private readonly body = new THREE.Group()
  private readonly armPivot = new THREE.Group()
  private readonly head = new THREE.Group()
  private readonly clubHolder = new THREE.Group()

  private readonly geometries: THREE.BufferGeometry[] = []
  private readonly materials: THREE.Material[] = []
  private readonly clubBase = new THREE.Quaternion()
  private readonly wristQ = new THREE.Quaternion()
  /** 握把到球的实测距离，杆长按它给 —— 写死 0.95 会让杆头要么悬空要么插进地里 */
  private clubReach = 0.91
  private currentPose: SwingPose = ADDRESS_POSE
  private idleTime = 0

  constructor() {
    this.group.add(this.body)

    this.addLeg(-0.1)
    this.addLeg(0.1)
    this.buildSkirt()
    this.buildTorso()
    this.buildHead()
    this.buildArms()

    const aim = this.computeAim()
    this.clubBase.copy(aim.quaternion)
    this.clubReach = aim.reach
    this.clubHolder.position.copy(GRIP)
    this.clubHolder.quaternion.copy(this.clubBase)
    this.armPivot.add(this.clubHolder)

    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = true
    })
  }

  // ---------------------------------------------------------------- 外观构建

  private buildTorso(): void {
    // 车削轮廓：腰细、胸宽、肩往下收。用 LatheGeometry 而不是胶囊体，
    // 因为胶囊是等半径的 —— 从上到下一样粗，读起来像一根管子
    // 胸围必须**窄于**肩线（SHOULDER_X 0.17），否则两条手臂会整个埋进躯干轮廓里，
    // 从背后看就是"没有胳膊的桶"。但顶到肩高（1.19）这一圈又要放宽到 0.162 ——
    // 否则肩头和躯干之间会裂出一道缝，袖口变成两块贴在身侧的橙色方片
    const profile = [
      new THREE.Vector2(0.136, 0.86),
      new THREE.Vector2(0.144, 0.93),
      new THREE.Vector2(0.15, 1.0),
      new THREE.Vector2(0.154, 1.07),
      new THREE.Vector2(0.159, 1.14),
      new THREE.Vector2(0.162, 1.19),
      new THREE.Vector2(0.134, 1.235),
      new THREE.Vector2(0.0, 1.25),
    ]
    const torso = this.mesh(
      new THREE.LatheGeometry(profile, 20),
      this.solid(POLO, 0.86, THREE.DoubleSide),
    )
    // 前后压扁一点，正圆截面从背后看像个桶
    torso.scale.set(1, 1, 0.82)
    this.body.add(torso)

    // 领口：深蓝一圈，把 polo 和脖子分开
    const collar = this.mesh(
      new THREE.CylinderGeometry(0.078, 0.094, 0.05, 16),
      this.solid(SKIRT, 0.85),
    )
    collar.position.y = 1.246
    collar.scale.set(1, 1, 0.85)
    this.body.add(collar)

    // 脖子粗一档：头放大后细脖子会像插在肩膀上的球
    const neck = this.mesh(
      new THREE.CylinderGeometry(0.062, 0.07, 0.1, 12),
      this.solid(SKIN, 0.8),
    )
    neck.position.y = 1.295
    this.body.add(neck)
  }

  private buildSkirt(): void {
    // A 字裙：腰 0.15 → 摆 0.26，带一点外弧。直筒圆锥从背后看像张纸片。
    // 摆线压到 0.58：0.62 时露出一大截白裤子，整条腿占到身高的 46%，
    // 看起来像穿了条迷你裙的竹竿
    const profile = [
      new THREE.Vector2(0.152, 0.905),
      new THREE.Vector2(0.167, 0.85),
      new THREE.Vector2(0.193, 0.77),
      new THREE.Vector2(0.223, 0.69),
      new THREE.Vector2(0.249, 0.62),
      new THREE.Vector2(0.259, 0.578),
    ]
    const skirt = this.mesh(
      new THREE.LatheGeometry(profile, 24),
      this.solid(SKIRT, 0.88, THREE.DoubleSide),
    )
    skirt.scale.set(1, 1, 0.9)
    this.body.add(skirt)

    // 摆边压深一档：单层车削曲面没有厚度，一道边才看得出裙子的下沿
    const hem = this.mesh(
      new THREE.CylinderGeometry(0.259, 0.268, 0.055, 24, 1, true),
      this.solid(SKIRT_DEEP, 0.9, THREE.DoubleSide),
    )
    hem.position.y = 0.588
    hem.scale.set(1, 1, 0.9)
    this.body.add(hem)

    // 白腰带：把 polo 和裙子隔开。少了它，珊瑚红一路压到裙腰，
    // 加上两条手臂挡在胸前，整件上衣会读成一颗"红心"
    const belt = this.mesh(
      new THREE.CylinderGeometry(0.139, 0.146, 0.036, 22),
      this.solid(PANTS, 0.8),
    )
    belt.position.y = 0.898
    belt.scale.set(1, 1, 0.85)
    this.body.add(belt)
  }

  private addLeg(x: number): void {
    // 上粗下细的一条腿 + 膝盖鼓包。等粗圆柱会读成两根白管子。
    // 头放大后腿也要跟着加粗，否则"大头细腿"会读成火柴人
    const leg = this.mesh(
      new THREE.CylinderGeometry(0.092, 0.064, HIP_Y - 0.05, 14),
      this.solid(PANTS, 0.9),
    )
    leg.position.set(x, (HIP_Y + 0.05) / 2, 0)
    this.body.add(leg)

    const knee = this.mesh(new THREE.SphereGeometry(0.078, 12, 10), this.solid(PANTS, 0.9))
    knee.position.set(x, 0.42, 0.004)
    knee.scale.set(1, 0.85, 1.05)
    this.body.add(knee)

    // 卡通鞋：压扁的球比方块讨喜得多，方盒子远看像块砖
    const shoe = this.mesh(new THREE.SphereGeometry(0.08, 16, 12), this.solid(SHOE, 0.6))
    shoe.position.set(x, 0.078, 0.035)
    shoe.scale.set(0.94, 0.8, 1.5)
    this.body.add(shoe)

    const sole = this.mesh(new THREE.BoxGeometry(0.142, 0.026, 0.248), this.solid(SOLE, 0.9))
    sole.position.set(x, 0.013, 0.035)
    this.body.add(sole)
  }

  private buildArms(): void {
    this.armPivot.position.copy(PIVOT_POS)
    this.body.add(this.armPivot)

    // 肩轭：一根横跨肩线的胶囊，把脖子两侧接到两个肩点上。
    // 少了它，躯干的车削轮廓在肩高处只有 0.134 宽，肩关节（x=0.17）落在轮廓外面，
    // 袖子会从肩线以上戳出来，正面看像两块肩章
    const yoke = this.mesh(
      new THREE.CapsuleGeometry(0.072, 0.2, 4, 14),
      this.solid(POLO, 0.86),
    )
    yoke.position.set(0, 1.205, 0)
    yoke.rotation.z = Math.PI / 2
    yoke.scale.set(1, 1, 0.92)
    this.body.add(yoke)

    const skinMaterial = this.solid(SKIN, 0.8)
    const poloMaterial = this.solid(POLO, 0.86)

    for (const side of [-1, 1]) {
      const shoulder = new THREE.Vector3(SHOULDER_X * side, 0, 0)
      const elbow = side < 0 ? ELBOW_L : ELBOW_R

      // 肩关节不需要额外的球帽：绕 X 轴摆动时，肩点 (±SHOULDER_X, 0, 0) 就在转轴上，
      // 位置根本不动，而它已经被肩轭端头的球（半径 0.072）整个包住。
      // 之前那两颗 r=0.046 的小球既填不住缝、又会从袖口里顶出来

      // 上臂：几乎垂直下垂，肘部略微外扩 —— 这样从背后能看到两条完整的胳膊
      this.segment(shoulder, elbow, 0.06, 0.053, skinMaterial)
      // 前臂：从肘部收到握把，双手在杆上会合
      this.segment(elbow, GRIP, 0.053, 0.046, skinMaterial)

      const joint = this.mesh(new THREE.SphereGeometry(0.052, 12, 10), skinMaterial)
      joint.position.copy(elbow)
      this.armPivot.add(joint)

      // polo 短袖：从肩点往下套住上臂根部。袖口必须比手臂明显宽
      // （末端 0.06 vs 手臂 0.055）—— 差 1–2mm 时手臂会从袖子里戳出来，
      // 在袖面上留下一道道竖着的深色条纹，看着像阴影脏斑
      const sleeve = this.mesh(
        new THREE.CylinderGeometry(0.068, 0.06, 0.14, 14),
        poloMaterial,
      )
      const dir = new THREE.Vector3().copy(elbow).sub(shoulder).normalize()
      sleeve.position.copy(shoulder).addScaledVector(dir, 0.07)
      sleeve.quaternion.setFromUnitVectors(DOWN, dir)
      this.armPivot.add(sleeve)
    }

    // 手套：两只手在握把处并在一起，所以是一颗略扁的球而不是两颗
    const hands = this.mesh(new THREE.SphereGeometry(0.062, 14, 12), this.solid(0xfbfcfb, 0.55))
    hands.position.copy(GRIP)
    hands.scale.set(1.3, 1, 1.1)
    this.armPivot.add(hands)
  }

  /** 一段锥形肢体：从 from 到 to，半径从 rFrom 收到 rTo */
  private segment(
    from: THREE.Vector3,
    to: THREE.Vector3,
    rFrom: number,
    rTo: number,
    material: THREE.Material,
  ): void {
    const dir = new THREE.Vector3().copy(to).sub(from)
    const length = dir.length()
    dir.normalize()

    const geometry = new THREE.CylinderGeometry(rTo, rFrom, length, 12)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.copy(from).addScaledVector(dir, length / 2)
    mesh.quaternion.setFromUnitVectors(UP, dir)
    mesh.castShadow = true
    this.geometries.push(geometry)
    this.armPivot.add(mesh)
  }

  private buildHead(): void {
    this.head.position.y = HEAD_Y
    this.body.add(this.head)

    const skull = this.mesh(new THREE.SphereGeometry(HEAD_R, 24, 18), this.solid(SKIN, 0.78))
    skull.scale.set(1, 1.04, 0.97)
    this.head.add(skull)

    // 五官。远看只是一点点像素，但推杆和落地机位会转到侧面/正面 ——
    // 没有脸的头就是一颗肉色球，这是整个角色"丑"的最大来源。
    // 所有位置乘 K（= HEAD_R/0.15），改头大小时五官不会散架
    for (const side of [-1, 1]) {
      const eye = this.mesh(new THREE.SphereGeometry(0.029 * K, 14, 12), this.solid(EYE, 0.45))
      eye.position.set(0.057 * K * side, 0.002 * K, 0.13 * K)
      eye.scale.set(0.94, 1.15, 0.6)
      this.head.add(eye)

      // 高光：一个小白点就能让眼睛"活"过来，成本只有 8×6 的球
      const glint = this.mesh(
        new THREE.SphereGeometry(0.0105 * K, 8, 6),
        this.solid(0xffffff, 0.3),
      )
      glint.position.set(0.064 * K * side, 0.016 * K, 0.148 * K)
      this.head.add(glint)

      // 眉毛：贴在同侧眼球正上方。z 要给到 0.14 —— 按球面算，(0.069, 0.05) 处的
      // 表面在 z=0.142，给到 0.155 眉毛就浮在脸前面了。
      // 角度必须给 0：正号外侧翘起 → 愁眉苦脸，负号内侧翘起 → 一脸凶相，
      // 只有平眉才是中性表情（大眼 + 平眉 + 微笑弧 = 卡通角色的"友好"配方）
      const brow = this.mesh(
        new THREE.BoxGeometry(0.046 * K, 0.011 * K, 0.013),
        this.solid(HAIR, 0.85),
      )
      brow.position.set(0.062 * K * side, 0.05 * K, 0.14)
      this.head.add(brow)
    }

    // 鼻子要小。给到 0.019 时是一颗球贴在脸上，0.014 才只是"一点鼻头"
    const nose = this.mesh(new THREE.SphereGeometry(0.014 * K, 10, 8), this.solid(SKIN_DEEP, 0.8))
    nose.position.set(0, -0.032 * K, 0.144 * K)
    nose.scale.set(1, 0.9, 0.8)
    this.head.add(nose)

    // 嘴：半圈圆环倒过来 = 一道微笑弧，比一个深色小方块可爱得多。
    // 半径给到 0.03 + 饱和红就成了小丑的嘴，收到 0.024 并压暗才像笑脸
    const mouth = this.mesh(
      new THREE.TorusGeometry(0.024 * K, 0.0058 * K, 6, 16, Math.PI),
      this.solid(MOUTH, 0.7),
    )
    mouth.position.set(0, -0.062 * K, 0.15)
    mouth.rotation.z = Math.PI
    this.head.add(mouth)

    this.buildCap()
  }

  private buildCap(): void {
    // 帽身停在眉毛上方（theta 0.40π → 下沿 y≈0.062）。再往下就把眉毛盖住了
    const crown = this.mesh(
      new THREE.SphereGeometry(HEAD_R + 0.008, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.4),
      this.solid(POLO, 0.85),
    )
    crown.position.y = 0.008
    crown.scale.set(1.02, 1, 1.02)
    this.head.add(crown)

    // 帽檐用半圆盘而不是方块：方块的两个尖角在球面上一眼就露馅。
    // 必须往前压、下倾 0.3 rad —— 平放的圆盘在齐眼高度的机位里是纯侧对镜头，
    // 只剩一条深色细带，读不出帽檐。
    // 再压扁 x（0.8）拉长 z（1.15）：正圆半盘的两端会绕到耳朵后面，
    // 从正面看就成了"环头一圈的深色带"，只有椭圆才收得进帽身里
    const brim = this.mesh(
      new THREE.CylinderGeometry(HEAD_R, HEAD_R, 0.022, 24, 1, false, -Math.PI / 2, Math.PI),
      this.solid(SKIRT, 0.85),
    )
    brim.position.set(0, 0.064, 0.053)
    brim.scale.set(0.8, 1, 1.15)
    brim.rotation.x = -0.3
    this.head.add(brim)

    const button = this.mesh(new THREE.SphereGeometry(0.013, 10, 8), this.solid(SKIRT, 0.8))
    button.position.y = 0.182
    this.head.add(button)

    // 后脑的头发：只取球体 z<0 那半边，正好在帽子下面，不会盖到脸。
    // phi 两头各收进 0.03π，接缝就落到最宽处后面 —— 从正面看才不会有
    // 一道黑线顺着脸颊劈下来（接缝正好落在轮廓线上时最明显）
    const hairBack = this.mesh(
      new THREE.SphereGeometry(HEAD_R + 0.004, 20, 14, Math.PI * 1.03, Math.PI * 0.94, Math.PI * 0.4, Math.PI * 0.52),
      this.solid(HAIR, 0.88, THREE.DoubleSide),
    )
    this.head.add(hairBack)

    // 马尾：贴着后脑往下、再往后甩。长度给到 0.3 时末端垂到肩膀，
    // 从背后看就是一块盖住脖子的黑布 —— 收到 0.29 并加大后仰角
    const tailDir = new THREE.Vector3(0, -0.55, -0.84).normalize()
    const tailLength = 0.29
    const tailBase = new THREE.Vector3(0, -0.033, -0.142)
    // 注意端点：setFromUnitVectors(DOWN, tailDir) 会把几何体的 +Y 端翻到靠头那侧，
    // 所以第一个半径是"靠近发圈"的一端 —— 要粗，远端才收细
    const tail = this.mesh(
      new THREE.CylinderGeometry(0.058, 0.027, tailLength, 10),
      this.solid(HAIR, 0.88),
    )
    tail.position.copy(tailBase).addScaledVector(tailDir, tailLength / 2)
    tail.quaternion.setFromUnitVectors(DOWN, tailDir)
    this.head.add(tail)

    const tip = this.mesh(new THREE.SphereGeometry(0.029, 12, 10), this.solid(HAIR, 0.88))
    tip.position.copy(tailBase).addScaledVector(tailDir, tailLength + 0.009)
    this.head.add(tip)

    // 发圈：一点珊瑚红，和 polo 呼应
    const tie = this.mesh(
      new THREE.TorusGeometry(0.053, 0.012, 8, 14),
      this.solid(POLO, 0.7),
    )
    tie.position.copy(tailBase)
    tie.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tailDir)
    this.head.add(tie)
  }

  // ---------------------------------------------------------------- 摆位

  /**
   * 摆到球旁边并朝向击球方向。
   * 站位偏移（右 0.34 / 后 0.30）是真实瞄球位置：球大致落在身体中线偏右、
   * 略靠前，而不是像以前那样偏右 0.53 —— 那样左臂得横跨 0.42m 才够得到握把，
   * 整条胳膊被拉成一根斜杠。
   */
  place(ballPosition: THREE.Vector3, aimRad: number): void {
    const right = new THREE.Vector3(Math.cos(aimRad), 0, -Math.sin(aimRad))
    const forward = new THREE.Vector3(Math.sin(aimRad), 0, Math.cos(aimRad))
    this.group.position
      .copy(ballPosition)
      .addScaledVector(right, -STAND_OFFSET_RIGHT)
      .addScaledVector(forward, -STAND_OFFSET_BACK)
    this.group.position.y = ballPosition.y - BALL_RADIUS_M
    this.group.rotation.y = aimRad
  }

  /**
   * 杆身朝向 + 握把到球的距离。全部是常量推导，构造时算一次即可。
   *
   * 关键是空间换算：球的位置是在**角色本地**（= body 空间）里给的，
   * 但杆挂在 armPivot 上，而 armPivot 是 body 的子节点、body 又按 torsoY 转了。
   * 所以先把球绕 Y 反旋回 pivot 的朝向，再减掉 pivot 挂点 ——
   * 少了这一步，杆身会偏 10° 左右，杆头永远差几厘米够不到球。
   */
  private computeAim(): { quaternion: THREE.Quaternion; reach: number } {
    const ball = new THREE.Vector3(STAND_OFFSET_RIGHT, BALL_RADIUS_M, STAND_OFFSET_BACK)
    ball.sub(PIVOT_POS)
    ball.applyQuaternion(
      new THREE.Quaternion().setFromAxisAngle(Y_AXIS, -ADDRESS_POSE.torsoY),
    )
    const reach = ball.distanceTo(GRIP)
    ball.sub(GRIP).normalize()
    return {
      quaternion: new THREE.Quaternion().setFromUnitVectors(DOWN, ball),
      reach,
    }
  }

  // ---------------------------------------------------------------- 球杆

  setClub(club: Club): void {
    for (const child of [...this.clubHolder.children]) {
      this.clubHolder.remove(child)
    }

    const headGeometry =
      club.id === 'driver'
        ? new THREE.SphereGeometry(0.078, 16, 12)
        : club.id === 'putter'
          ? new THREE.BoxGeometry(0.11, 0.036, 0.055)
          : new THREE.BoxGeometry(0.076, 0.046, 0.046)

    const headMaterial = new THREE.MeshStandardMaterial({
      color: club.id === 'driver' ? 0x2b2f36 : 0x9aa3ab,
      roughness: 0.35,
      metalness: 0.75,
    })

    // 杆长 = 握把到球的距离减去杆头自身的半径，杆头中心才正好落在球边上。
    // 写死一个数会让杆头要么悬在球上方、要么插进草里。
    const shaftLength = this.clubReach - (club.id === 'driver' ? 0.045 : 0.032)
    const shaftGeometry = new THREE.CylinderGeometry(0.019, 0.024, shaftLength, 8)
    const shaftMaterial = new THREE.MeshStandardMaterial({
      color: CLUB_SHAFT,
      roughness: 0.3,
      metalness: 0.85,
    })

    const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial)
    shaft.position.y = -shaftLength / 2
    shaft.castShadow = true
    this.clubHolder.add(shaft)

    const head = new THREE.Mesh(headGeometry, headMaterial)
    head.position.set(club.id === 'putter' ? 0.02 : 0.03, -shaftLength, 0.01)
    head.castShadow = true
    this.clubHolder.add(head)

    this.geometries.push(headGeometry, shaftGeometry)
    this.materials.push(headMaterial, shaftMaterial)
  }

  // ---------------------------------------------------------------- 动画

  /** 平滑过渡到目标姿势；挥杆中跟随得更紧一些 */
  setPose(target: SwingPose, dt: number, snappy: boolean): void {
    const rate = snappy ? 26 : 12
    const t = Math.min(1, dt * rate)
    this.currentPose = {
      torsoY: this.currentPose.torsoY + (target.torsoY - this.currentPose.torsoY) * t,
      armsX: this.currentPose.armsX + (target.armsX - this.currentPose.armsX) * t,
      lean: this.currentPose.lean + (target.lean - this.currentPose.lean) * t,
      wrist: this.currentPose.wrist + (target.wrist - this.currentPose.wrist) * t,
    }

    this.body.rotation.y = this.currentPose.torsoY
    this.body.rotation.x = this.currentPose.lean
    this.armPivot.rotation.x = this.currentPose.armsX
    this.head.rotation.y = -this.currentPose.torsoY * 0.55

    // 手腕在"杆身指向球"的基准朝向上再绕 X 折一次：
    // premultiply 是在父空间（肩 pivot）里转，所以手腕角度和手臂角度是相加的，
    // 而不是被基准朝向抵消掉。
    this.wristQ.setFromAxisAngle(WRIST_AXIS, this.currentPose.wrist)
    this.clubHolder.quaternion.copy(this.clubBase).premultiply(this.wristQ)
  }

  /** 待机呼吸 + 头部微摆 */
  update(dt: number, idle: boolean): void {
    this.idleTime += dt
    if (idle) {
      const sway = Math.sin(this.idleTime * 1.6) * 0.012
      this.body.position.y = sway
      this.head.rotation.z = Math.sin(this.idleTime * 1.1) * 0.03
    } else {
      this.body.position.y += (0 - this.body.position.y) * Math.min(1, dt * 8)
    }
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose()
    for (const material of this.materials) material.dispose()
  }

  // ---------------------------------------------------------------- 工具

  /**
   * 卡通材质：无金属度、高粗糙度，再给一点同色自发光把暗面抬起来。
   * 写实材质在背光侧会掉成灰黑，低模一旦暗下去就显廉价；
   * 抬亮暗面之后颜色始终是"平涂"的，这才是卡通感的来源。
   */
  private solid(color: number, roughness = 0.85, side: THREE.Side = THREE.FrontSide): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness: 0,
      side,
    })
    material.emissive = new THREE.Color(color)
    material.emissiveIntensity = 0.07
    return material
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.geometries.push(geometry)
    this.materials.push(material)
    return mesh
  }
}
