import { atom, read, update } from 'claude-code'
import type { EngineInterface, HookStream, ProcessSpawnChunk, ProcessSpawnResult, Register } from 'claude-code'

import type { View } from '../types'
import { pack, walk, type PadMessage } from './pad'

const PANE = 'splat'
const TMP = '/tmp/claude-splat-preview'
const USAGE = 'Usage: /splat <file.ply|.splat|.spz|.ksplat|.sog>'
const view = atom({ plugin: '3dgs-view', key: 'view' } as const, null as View | null)
const offer = atom({ plugin: '3dgs-view', key: 'offer' } as const, null as string | null)
const SPLAT_PATH = /[^\s"'`()[\]]+\.(?:ply|splat|spz|ksplat|sog)\b/gi
// ponytail: module-level, so a reload forgets what was declined; good enough
const seen = new Set<string>()

// ponytail: module-level, what the pane last drew at; a reload starts from 80x25 until the next draw
let grid = { columns: 80, rows: 25 }
// ponytail: no capability query in the API, so the terminal's name says whether it draws images
const drawsImages = (program: string, term: string) => program === 'ghostty' || program === 'WezTerm' || term === 'xterm-kitty'

// ponytail: module-level, one server per session; a reload drops the handle and the engine kills the child
let server: HookStream<ProcessSpawnChunk, ProcessSpawnResult> | undefined

const resolve = async ($: EngineInterface, arg: string) => {
  if (arg.startsWith('/')) return arg
  if (arg.startsWith('~/')) return ((await $.env.get('HOME')) ?? '') + arg.slice(1)
  return `${await $.session.cwd()}/${arg}`
}

// Any splat path in `text` that exists and was not offered yet becomes the band's offer.
const detect = async ($: EngineInterface, text: string) => {
  for (const hit of text.match(SPLAT_PATH) ?? []) {
    const file = await resolve($, hit)
    if (seen.has(file) || (await read($, view))?.file === file) continue
    const stat = await $.fs.stat(file).catch(() => undefined)
    if (stat?.kind !== 'file') continue
    seen.add(file)
    await update($, offer, () => file)
    return
  }
}

const patch = ($: EngineInterface, fn: (v: View) => Partial<View>) =>
  update($, view, v => (v ? { ...v, ...fn(v) } : v))

type Camera = { az: number; el: number; d: number; px: number; py: number; pz: number; mode: View['mode'] }
const STEP = 0.08 // a w/s step in look mode, in units of the scene radius

const camQuery = (at: Camera) => `az=${at.az}&el=${at.el}&d=${at.d.toFixed(2)}&px=${at.px}&py=${at.py}&pz=${at.pz}${at.mode === 'look' ? '&look=1' : ''}`

const snap = async ($: EngineInterface, cam: Partial<Camera>, fast = false) => {
  const v = await read($, view)
  if (!v?.url) return
  const mode = cam.mode ?? v.mode
  const at: Camera = { az: cam.az ?? v.az, el: cam.el ?? v.el, d: Math.min(4, Math.max(0.1, cam.d ?? v.d)), px: cam.px ?? v.px, py: cam.py ?? v.py, pz: cam.pz ?? v.pz, mode }
  await patch($, () => ({ ...at, status: fast ? 'dragging' : 'rendering' }))
  // ponytail: curl is on every mac/linux box; the server owns the Chrome process
  const ar = (grid.columns / (grid.rows * 2)).toFixed(3) // cells are about 1:2
  await $.process.run(['curl', '-s', `${v.url}snap?${camQuery(at)}&ar=${ar}${fast ? '&fast=1' : ''}`], { timeoutMs: 5000 })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // a (re)load means any earlier server of ours is gone with the old module: start the pane clean
    await update($, view, () => null)
    await update($, offer, () => null)
    await $.command.register({
      name: 'splat',
      description: 'Preview a 3D Gaussian splat file in a pane (Spark renderer)',
    })
    return next(e)
  })

  on('command.run', { command: 'splat' }, async ($, e) => {
    const arg = e.args.trim()
    if (!arg) return { text: USAGE }
    const file = await resolve($, arg)
    const stat = await $.fs.stat(file).catch(() => undefined)
    if (stat?.kind !== 'file') return { text: `splat: not a file: ${file}` }
    seen.add(file)
    await update($, offer, () => null)

    const hasImages = drawsImages((await $.env.get('TERM_PROGRAM')) ?? '', (await $.env.get('TERM')) ?? '')

    await server?.return(undefined as never)
    const shot = `${TMP}/${Date.now()}.png` // fresh name per splat: the terminal caches by path
    const child = $.process.spawn({
      argv: ['python3', `${$.plugin.root}/hooks/serve.py`, `${$.plugin.root}/hooks/viewer.html`, file, shot],
    })
    server = child
    await update($, view, () => ({
      file, size: stat.size, splats: 0, url: '', shot, generation: 0, az: 30, el: 20, d: 1, px: 0, py: 0, pz: 0, mode: 'orbit', hasImages, status: 'starting server',
    }))

    void (async () => {
      try {
        for await (const { stream, text } of child) {
          if (stream !== 'stdout') continue
          for (const line of text.split('\n').filter(Boolean)) {
            if (/^\d+$/.test(line)) {
              await patch($, () => ({ url: `http://localhost:${line}/`, status: 'loading splat' }))
              void snap($, {})
            } else if (line === 'SHOT') {
              await patch($, v => ({ generation: v.generation + 1, status: 'ready' }))
            } else if (line.startsWith('LOG N ')) {
              await patch($, () => ({ splats: Number(line.slice(6)) }))
            } else {
              await patch($, () => ({ status: line.slice(4) }))
            }
          }
        }
      } catch (err) {
        await patch($, () => ({ status: `server failed: ${String(err)}` }))
      }
    })()

    await $.ui.open({ id: PANE, title: 'Splat', focus: true })
    return { text: `Previewing ${file}` }
  })

  // /clear, /resume and /branch reset every $.state value but leave the server: stop it and close the pane
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await server?.return(undefined as never)
    server = undefined
    await $.ui.close({ id: PANE })
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await detect($, e.text)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    await detect($, JSON.stringify(e))
    return next(e)
  })

  on('ui.message', { element: 'pad' }, async ($, e, next) => {
    const m = e.data as PadMessage
    void snap($, { az: m.az, el: m.el, px: m.px, py: m.py, pz: m.pz, mode: m.mode }, m.fast)
    return next(e)
  })

  // the wheel over the pane zooms instead of scrolling it: down zooms out, up zooms in.
  // ponytail: a trackpad fires many small events per gesture, so 3% a row and a clamp, not 15% a tick
  on('ui.scroll', { requestId: PANE }, async ($, e) => {
    const v = await read($, view)
    // look mode walks instead: wheel down steps back, wheel up steps forward
    if (v) void snap($, v.mode === 'look' ? walk(v, -0.02 * e.by, 0) : { d: v.d * Math.pow(1.03, e.by) })
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const file = await read($, offer)
    if (!file || e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const dismiss = () => update($, offer, () => null)
    const theirs = await next(e) // what the mods after this one draw in the band stays
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="claude">◆ </Text>
          <Text>Preview {file.split('/').pop()} in the splat pane? </Text>
          <Button hotkey="1" plain onPress={() => void $.command.run({ command: 'splat', args: file })}>Yes</Button>
          <Text> </Text>
          <Button hotkey="2" plain onPress={() => void dismiss()}>No</Button>
        </Box>
        {theirs}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const v = await read($, view)
    if (!v) return <Text dimColor>{USAGE}</Text>
    const name = v.file.split('/').pop()
    const columns = Math.min(e.viewport?.columns ?? 80, 160) - 2
    const isBusy = v.status !== 'ready'
    const isLook = v.mode === 'look'
    // orbit: a/d circle the scene; look: they turn the head, which runs the other way round
    const turn = isLook ? 1 : -1
    const statusColor = v.status.includes('failed') || v.status.startsWith('ERR') ? 'error' : isBusy ? 'warning' : 'success'

    // the footer is laid out here, not by the terminal, so the picture can take exactly the rows it leaves
    // the browser opens where the pane looks, in the same mode
    const ext = v.file.split('.').pop()?.toLowerCase() ?? ''
    const openBrowser = () => void $.process.run(['open', `${v.url}?ext=${ext}&${camQuery(v)}`])
    const keys: [hotkey: string, label: string, onPress: () => void][] = [
      ['a', isLook ? '◀ turn' : '◀ orbit', () => void snap($, { az: v.az + 20 * turn })],
      ['d', isLook ? 'turn ▶' : 'orbit ▶', () => void snap($, { az: v.az - 20 * turn })],
      ['q', isLook ? '▲ look up' : '▲ up', () => void snap($, { el: Math.max(-85, Math.min(85, v.el - 15 * turn)) })],
      ['e', isLook ? '▼ look down' : '▼ down', () => void snap($, { el: Math.max(-85, Math.min(85, v.el + 15 * turn)) })],
      ['w', isLook ? 'forward' : 'zoom in', () => void snap($, isLook ? walk(v, STEP, 0) : { d: v.d * 0.7 })],
      ['s', isLook ? 'back' : 'zoom out', () => void snap($, isLook ? walk(v, -STEP, 0) : { d: v.d / 0.7 })],
      ['m', isLook ? 'mode: look around' : 'mode: orbit', () => void snap($, { mode: isLook ? 'orbit' : 'look', d: 1, px: 0, py: 0, pz: 0 })],
      ['r', 'reset', () => void snap($, { az: 30, el: 20, d: 1, px: 0, py: 0, pz: 0 })],
      ['o', 'open in browser', openBrowser],
    ]
    const KEY_GAP = 3
    const lines = pack(keys, ([, label]) => label.length + 3, columns, KEY_GAP) // a plain Button draws "k: label"
    const readout = `${isLook ? 'look around' : 'orbit'} · az ${v.az}° · el ${v.el}°${isLook ? '' : ` · dist ${v.d.toFixed(2)}`}`
    // the longest hint that fits beside the readout, else none
    const hint = [
      `${isLook ? 'drag looks · right-drag slides · wheel walks' : 'drag orbits · right-drag pans · wheel zooms'} · esc to prompt`,
      'esc to prompt',
    ].find(h => readout.length + 2 + h.length <= columns)
    // the pane's body less its frame, our header and status rows and the key lines
    const rows = Math.max(8, Math.min(120, (e.viewport?.rows ?? 24) - 11 - lines.length))
    grid = { columns, rows }
    const header = (
      <Box>
        <Text color="claude" bold>◆ {name}</Text>
        <Text dimColor>  {(v.size / 1e6).toFixed(0)} MB{v.splats ? ` · ${(v.splats / 1e6).toFixed(1)}M splats` : ''}</Text>
        <Text>  </Text>
        <Text color={statusColor}>● {v.status}</Text>
      </Box>
    )
    const browser = <Button hotkey="o" plain onPress={openBrowser}>open in browser</Button>

    // a terminal without image support gets the link, not a picture
    if (!v.hasImages || e.surface !== 'terminal') {
      return (
        <Box flexDirection="column">
          {header}
          <Text dimColor>This terminal draws no images. Ghostty, kitty and WezTerm show the preview inline.</Text>
          {v.url && <Link href={v.url} label="interactive viewer (orbit with the mouse)" />}
          {v.url && <Box>{browser}</Box>}
        </Box>
      )
    }

    const { Image, Client } = $.ui.resolve(e)
    const picture =
      v.generation > 0 ? (
        <Box width={columns} height={rows}>
          <Image
            key="shot"
            source={{ file: v.shot, format: 'png', generation: v.generation }}
            columns={columns}
            rows={rows}
            alt="splat preview: this terminal did not draw the image; press o for the browser"
          />
          <Box position="absolute" top={0} left={0}>
            <Client key="pad" module="./pad.tsx" props={{ az: v.az, el: v.el, px: v.px, py: v.py, pz: v.pz, mode: v.mode }} width={columns} height={rows} />
          </Box>
        </Box>
      ) : (
        <Box width={columns} height={rows} borderStyle="round" borderColor="subtle" alignItems="center" justifyContent="center">
          <Text dimColor>{v.status}…</Text>
        </Box>
      )

    return (
      <Box flexDirection="column">
        {header}
        {picture}
        <Box width={columns} justifyContent="space-between">
          <Text dimColor>{readout}</Text>
          {hint && <Text dimColor>{hint}</Text>}
        </Box>
        {lines.map(line => (
          <Box key={line.map(([hotkey]) => hotkey).join()} columnGap={KEY_GAP}>
            {line.map(([hotkey, label, onPress]) => <Button key={hotkey} hotkey={hotkey} plain onPress={onPress}>{label}</Button>)}
          </Box>
        ))}
      </Box>
    )
  })
}
