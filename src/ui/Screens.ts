import { formatRelative } from '../game/Scoring'

interface ActionSpec {
  label: string
  onClick: () => void
}

/**
 * 全屏遮罩：标题、进洞、结算、暂停。主按钮可被 Enter/空格触发。
 * 版式统一为 kicker → 主体 → 分隔线 → 说明 → 按钮 → 按键提示，
 * 四个屏共用一套骨架，玩家不用重新找按钮在哪。
 */
export class Screens {
  private readonly root: HTMLDivElement
  private primaryAction: ActionSpec | null = null

  constructor() {
    this.root = document.createElement('div')
    this.root.className = 'screen'
    this.root.hidden = true
    document.body.appendChild(this.root)
  }

  get visible(): boolean {
    return !this.root.hidden
  }

  confirm(): void {
    this.primaryAction?.onClick()
  }

  showTitle(onStart: () => void): void {
    this.render(
      `
        <p class="screen__kicker">3D Mini Golf</p>
        <h1 class="screen__title">美人挥杆</h1>
        <div class="screen__rule"></div>
        <p class="screen__lead">三洞林克斯球场 · 拖拽挥杆 · 看小白球飞向果岭</p>
        <ul class="screen__tips">
          <li>按住球场任意处，向下拖动蓄力</li>
          <li>左右拖动调整瞄准，松手出杆</li>
          <li>1–4 或点击底部按钮换球杆</li>
        </ul>
    `,
      { label: '开始比赛', onClick: onStart },
      '按 Enter 或空格开始',
    )
  }

  showHoleComplete(options: {
    holeNumber: number
    par: number
    strokes: number
    scoreName: string
    nextPar: number
    onNext: () => void
  }): void {
    this.render(
      `
        <p class="screen__kicker">第 ${options.holeNumber} 洞完成</p>
        <span class="score-big">${options.strokes}<em>杆</em></span>
        <span class="score-delta">${options.scoreName}</span>
        <div class="screen__rule"></div>
        <p class="screen__lead">标准杆 ${options.par} · 下一洞标准杆 ${options.nextPar}</p>
    `,
      { label: '下一洞', onClick: options.onNext },
      '按 Enter 或空格继续',
    )
  }

  showRoundComplete(options: {
    strokes: number
    par: number
    relative: number
    best: string
    onRestart: () => void
  }): void {
    this.render(
      `
        <p class="screen__kicker">比赛结束</p>
        <span class="score-big">${options.strokes}<em>杆</em></span>
        <span class="score-delta">${formatRelative(options.relative)}</span>
        <div class="screen__rule"></div>
        <p class="screen__lead">标准杆 ${options.par}</p>
        <p class="screen__lead">最佳单洞：${options.best}</p>
    `,
      { label: '再来一局', onClick: options.onRestart },
      '按 Enter 或空格重开',
    )
  }

  showPaused(onResume: () => void): void {
    this.render(
      `
        <p class="screen__kicker">已暂停</p>
        <h2 class="screen__title">休息一下</h2>
        <div class="screen__rule"></div>
        <p class="screen__lead">当前进度已保留，随时可以继续。</p>
    `,
      { label: '继续', onClick: onResume },
      '按 Esc 或 P 继续',
    )
  }

  hide(): void {
    this.root.hidden = true
    this.root.innerHTML = ''
    this.primaryAction = null
  }

  dispose(): void {
    this.root.remove()
    this.primaryAction = null
  }

  private render(innerHtml: string, primary: ActionSpec, hint = ''): void {
    const hintHtml = hint ? `<p class="screen__hint">${hint}</p>` : ''
    // 按钮与提示都放进卡片内部：否则 grid 会把它们排成卡片外独立的行
    this.root.innerHTML = `
      <div class="screen__card">
        ${innerHtml}
        <div class="screen__actions"><button class="btn btn--primary" type="button">${primary.label}</button></div>
        ${hintHtml}
      </div>
    `
    const button = this.root.querySelector('button')
    button?.addEventListener('click', () => primary.onClick())
    this.primaryAction = primary
    this.root.hidden = false
  }
}
