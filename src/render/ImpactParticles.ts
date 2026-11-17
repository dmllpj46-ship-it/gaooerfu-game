import * as THREE from 'three'

/**
 * 击球/落地的小尘粒。用一个 Points + 固定粒子池，避免每杆创建新对象。
 */
export class ImpactParticles {
  private readonly points: THREE.Points
  private readonly positions: Float32Array
  private readonly velocities: Float32Array
  private readonly life: Float32Array
  private readonly max: number
  private readonly material: THREE.PointsMaterial
  private activeLife = 0
  private activeMax = 0

  constructor(scene: THREE.Scene, max = 72) {
    this.max = max
    this.positions = new Float32Array(max * 3)
    this.velocities = new Float32Array(max * 3)
    this.life = new Float32Array(max)
    this.positions.fill(-9999)

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))

    this.material = new THREE.PointsMaterial({
      color: 0xe9dfc2,
      size: 0.055,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })

    this.points = new THREE.Points(geometry, this.material)
    this.points.frustumCulled = false
    this.points.name = 'impact-particles'
    scene.add(this.points)
  }

  burst(position: THREE.Vector3, strength: number): void {
    const count = Math.min(this.max, 24 + Math.round(strength * 36))
    for (let i = 0; i < count; i++) {
      const offset = i * 3
      this.positions[offset] = position.x
      this.positions[offset + 1] = position.y
      this.positions[offset + 2] = position.z

      const angle = Math.random() * Math.PI * 2
      const spread = 0.6 + Math.random() * 1.6 * (0.4 + strength)
      this.velocities[offset] = Math.cos(angle) * spread
      this.velocities[offset + 1] = 1.2 + Math.random() * 2.4 * (0.3 + strength)
      this.velocities[offset + 2] = Math.sin(angle) * spread

      this.life[i] = 0.45 + Math.random() * 0.35
    }
    this.activeLife = 0.8
    this.activeMax = 0.8
    this.material.opacity = 0.85
    ;(this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
  }

  update(dt: number): void {
    if (this.activeLife <= 0) return
    this.activeLife = Math.max(0, this.activeLife - dt)

    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue
      const offset = i * 3
      this.life[i] -= dt

      this.velocities[offset + 1] -= 9.81 * dt
      this.positions[offset] += this.velocities[offset] * dt
      this.positions[offset + 1] += this.velocities[offset + 1] * dt
      this.positions[offset + 2] += this.velocities[offset + 2] * dt

      if (this.life[i] <= 0) {
        this.positions[offset] = -9999
        this.positions[offset + 1] = -9999
        this.positions[offset + 2] = -9999
      }
    }

    this.material.opacity = 0.85 * (this.activeLife / this.activeMax)
    ;(this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
  }

  dispose(): void {
    this.points.removeFromParent()
    this.points.geometry.dispose()
    this.material.dispose()
  }
}
