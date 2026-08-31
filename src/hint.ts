/**
 * The one-time nudge: a soft pad next to the cardboard edge, sliding the way
 * the finger should. It never touches the opening value, and it goes as soon
 * as a real drag starts.
 */
export class Hint {
  private el = document.getElementById('hint') as HTMLElement;
  private shown = false;
  private dead = false;
  private t = 0;

  update(dt: number, x: number, y: number, visible: boolean) {
    if (this.dead) return;
    this.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    if (!this.shown) {
      this.t += dt;
      if (this.t > 0.9 && visible) {
        this.shown = true;
        this.el.classList.add('on');
      }
    }
  }

  kill() {
    if (this.dead) return;
    this.dead = true;
    this.el.classList.remove('on');
    window.setTimeout(() => this.el.remove(), 600);
  }
}
