export type View = {
  file: string
  size: number
  splats: number
  url: string
  shot: string
  generation: number
  az: number
  el: number
  d: number
  px: number
  py: number
  /** look mode only: px, py, pz are the eye's world offset from the scene center */
  pz: number
  /** orbit circles the scene; look stands at a spot, turns in place and walks */
  mode: 'orbit' | 'look'
  status: string
  hasImages: boolean
}

declare module 'claude-code' {
  interface PluginState {
    '3dgs-view': { view: View | null; offer: string | null }
  }
}
