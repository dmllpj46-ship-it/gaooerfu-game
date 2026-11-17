import './ui/style.css'
import { Game } from './core/Game'
import { settings } from './core/Settings'

const canvas = document.querySelector<HTMLCanvasElement>('#game')

if (!canvas) {
  showBootError('找不到画布元素 #game。')
} else {
  try {
    const game = new Game(canvas)
    game.start()
    if (settings.debug) {
      // ?debug=1：把实例挂到 window，方便在控制台里查相机/场景（M1 调机位要用）
      Reflect.set(window, '__game', game)
    }
    // 开发时热更新会重建模块，先释放旧实例的 GPU 资源
    if (import.meta.hot) {
      import.meta.hot.dispose(() => game.dispose())
    }
  } catch (error) {
    console.error(error)
    showBootError(error instanceof Error ? error.message : String(error))
  }
}

function showBootError(message: string): void {
  const element = document.querySelector<HTMLElement>('#boot-error')
  if (!element) return
  element.textContent = `启动失败：${message}\n\n请确认浏览器支持 WebGL 2。`
  element.hidden = false
}
