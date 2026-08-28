import { App } from './core/App'

const canvas = document.getElementById('gl') as HTMLCanvasElement
const touch = document.getElementById('touch') as HTMLElement
const title = document.getElementById('title') as HTMLElement
const startBtn = document.getElementById('start') as HTMLButtonElement
const loading = document.getElementById('loading') as HTMLElement

const app = new App(canvas, touch)
;(window as any).__app = app
app.run()

requestAnimationFrame(() => {
  loading.classList.add('hidden')
  setTimeout(() => app.loadFarField(), 60)
})

const begin = () => {
  title.classList.add('hidden')
  app.startGame()
  startBtn.removeEventListener('click', begin)
}
startBtn.addEventListener('click', begin)
