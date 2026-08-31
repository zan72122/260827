/** 決定的な擬似乱数。工房の小物配置などに使い、seed を固定すれば同じ絵になる。 */
export function makeRng(seed: number): () => number {
  let s = (seed >>> 0) || 1
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
}

export function seedFromLocation(search: string): number {
  const m = /(?:^|[?&])seed=(\d+)/.exec(search)
  return m ? Number(m[1]) >>> 0 : 20261225
}
