import { App } from './core/app'

const canvas = document.getElementById('scene') as HTMLCanvasElement

function fail(message: string) {
  const veil = document.getElementById('veil')
  if (veil) {
    veil.innerHTML = `<h1>ごめんね<br />この がめんでは あそべません</h1>
      <div class="sub">${message}</div>`
    veil.classList.remove('gone')
  }
}

try {
  const app = new App(canvas)
  app.start()
  window.addEventListener('pagehide', () => app.dispose(), { once: true })
} catch (err) {
  console.error(err)
  fail('WebGL が つかえないみたい')
}
