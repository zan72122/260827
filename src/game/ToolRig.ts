import * as THREE from 'three';
import type { Materials } from '../content/Materials';
import {
  makeChefKnife,
  makePaletteKnife,
  makePipingBag,
  makeServer,
} from '../content/Props';
import { makeHand } from '../content/Hands';

export type ToolName = 'none' | 'knife' | 'palette' | 'piping' | 'server';

/**
 * The tools and the hand that holds them. The hand is deliberately kept at the
 * edge of the frame: enough of a person to make the bench feel worked at, never
 * enough to become a character.
 */
export class ToolRig {
  readonly root = new THREE.Group();
  readonly knife: THREE.Group;
  readonly palette: THREE.Group;
  readonly server: THREE.Group;
  readonly piping: THREE.Group;
  readonly nozzleTip: THREE.Object3D;
  private readonly hand: THREE.Group;
  private current: ToolName = 'none';
  private handShown = true;

  constructor(materials: Materials) {
    this.knife = makeChefKnife(materials);
    this.palette = makePaletteKnife(materials);
    this.server = makeServer(materials);
    const bag = makePipingBag(materials);
    this.piping = bag.group;
    this.nozzleTip = bag.tip;
    const hand = makeHand(materials, 'right');
    this.hand = hand.group;

    for (const t of [this.knife, this.palette, this.server, this.piping]) {
      t.visible = false;
      this.root.add(t);
    }
    this.root.add(this.hand);
    this.hand.visible = false;
  }

  /**
   * `withHand` is false while the child is driving the tool themselves: their
   * own finger is already there, and a hand over the work would hide the cream
   * exactly where they are putting it.
   */
  show(tool: ToolName, withHand = true): void {
    if (this.current === tool && this.handShown === withHand) return;
    this.current = tool;
    this.handShown = withHand;
    this.knife.visible = tool === 'knife';
    this.palette.visible = tool === 'palette';
    this.server.visible = tool === 'server';
    this.piping.visible = tool === 'piping';
    this.hand.visible = withHand && tool !== 'none';
    const host =
      tool === 'knife'
        ? this.knife
        : tool === 'palette'
          ? this.palette
          : tool === 'server'
            ? this.server
            : tool === 'piping'
              ? this.piping
              : null;
    if (!host) {
      this.root.add(this.hand);
      return;
    }
    host.add(this.hand);
    if (tool === 'piping') {
      // Around the bag above the coupler, forearm leaving the top of frame.
      this.hand.position.set(0, 0.085, 0.006);
      this.hand.rotation.set(-1.24, 0, 0);
      this.hand.scale.setScalar(0.78);
    } else {
      // Behind the handle: fingers reach forward along it and curl round,
      // palm down, forearm running out of frame past the butt.
      this.hand.position.set(-0.092, 0.021, 0);
      this.hand.rotation.set(Math.PI, Math.PI / 2, 0);
      this.hand.scale.setScalar(0.78);
    }
  }

  get active(): ToolName {
    return this.current;
  }
}
