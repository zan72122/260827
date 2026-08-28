export type DestinationId =
  | 'lighthouse'
  | 'mountain'
  | 'city'
  | 'forest'
  | 'desert'
  | 'snowvillage';

/** Two dispatch methods of this fictional central office (not a real postal procedure). */
export type DispatchKind = 'today' | 'christmas';

export interface EnvelopeSpec {
  id: string;
  destination: DestinationId;
  dispatch: DispatchKind;
  /** millimetre-ish size variation, in metres */
  width: number;
  height: number;
  /** paper tone + fibre + wear vary per envelope */
  seed: number;
  tone: [number, number, number];
  fibre: number;
  wear: number;
  /** stamp corner: 0 = top-right, 1 = top-left */
  stampCorner: 0 | 1;
  /** small crease across one corner */
  fold: number;
}

export interface ReceptacleKey {
  destination: DestinationId;
  /** null in one-condition mode: any dispatch kind is accepted */
  dispatch: DispatchKind | null;
}
