import type { ClientModule } from 'claude-code'

export type PadProps = { az: number; el: number; px: number; py: number; pz: number; mode: 'orbit' | 'look' }
export type PadMessage = PadProps & { fast: boolean }

const DEG_PER_COL = 1.5
const DEG_PER_ROW = 3
const PAN_PER_COL = 0.01 // in units of the scene radius
const PAN_PER_ROW = 0.02

const round = (n: number) => +n.toFixed(3) || 0 // no -0 in the query string

/** Look mode: the eye after stepping `forward` and `right` along the ground, facing `az`, in units of the scene radius. */
export const walk = <C extends { az: number; px: number; pz: number }>(cam: C, forward: number, right: number): C => {
  const a = (cam.az * Math.PI) / 180 // the eye faces (-sin a, 0, -cos a); its right is (cos a, 0, -sin a)
  return { ...cam, px: round(cam.px - forward * Math.sin(a) + right * Math.cos(a)), pz: round(cam.pz - forward * Math.cos(a) - right * Math.sin(a)) }
}

/**
 * Camera after dragging `dx` columns and `dy` rows: the left button turns, the right one pans.
 * Both modes drag the world with the pointer; looking out from the eye turns the opposite way to circling it.
 */
export const dragTo = (start: PadProps, button: 'left' | 'right', dx: number, dy: number): PadProps => {
  const sign = start.mode === 'look' ? -1 : 1
  if (button === 'left')
    return { ...start, az: Math.round(start.az - sign * dx * DEG_PER_COL), el: Math.max(-85, Math.min(85, Math.round(start.el + sign * dy * DEG_PER_ROW))) }
  // look mode pans in the world, so the spot stays put while the head turns
  if (start.mode === 'look') return { ...walk(start, 0, -dx * PAN_PER_COL), py: round(start.py + dy * PAN_PER_ROW) }
  return { ...start, px: round(start.px - dx * PAN_PER_COL), py: round(start.py + dy * PAN_PER_ROW) }
}

/** Greedy line breaking: `items` split into lines, `gap` cells apart, none wider than `columns` unless one item alone is. */
export const pack = <T,>(items: T[], width: (item: T) => number, columns: number, gap: number): T[][] => {
  const lines: T[][] = []
  let line: T[] = []
  let used = 0
  for (const item of items) {
    const w = width(item)
    if (line.length > 0 && used + gap + w <= columns) { line.push(item); used += gap + w; continue }
    line = [item]
    used = w
    lines.push(line)
  }
  return lines
}

// ponytail: one pad per pane, so module scope holds the latest camera the pane drew
let latest: PadProps = { az: 0, el: 20, px: 0, py: 0, pz: 0, mode: 'orbit' }

const Pad: ClientModule<PadProps, { isWired: true }> = (props, s) => {
  latest = props
  if (!s.state) {
    let start: { x: number; y: number; button: 'left' | 'right'; from: PadProps } | undefined
    let sentAt = 0
    s.onPointer(e => {
      const x = e.fine?.x ?? e.x
      const y = e.fine?.y ?? e.y
      if (e.type === 'down' && (e.button === 'left' || e.button === 'right')) start = { x, y, button: e.button, from: latest }
      if (!start) return
      const at = dragTo(start.from, start.button, x - start.x, y - start.y)
      if (e.type === 'move' && Date.now() - sentAt > 120) {
        sentAt = Date.now()
        s.post({ ...at, fast: true } satisfies PadMessage)
      }
      if (e.type === 'up') {
        start = undefined
        s.post({ ...at, fast: false } satisfies PadMessage)
      }
    })
    s.setState({ isWired: true })
  }
  return s.elements.Box({ width: s.columns, height: s.rows })
}

export default Pad
