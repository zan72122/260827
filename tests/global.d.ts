export {};

declare global {
  interface Window {
    __santa?: {
      started: () => boolean;
      start: () => void;
      state: () => Record<string, unknown>;
      point: (id: string) => { x: number; y: number } | null;
      targetBay: () => string | null;
      wrongBay: () => string | null;
      setOneCondition: (v: boolean) => void;
      replay: () => void;
      startRound: (n: number) => void;
      portrait: () => boolean;
    };
  }
}
