import { expect, test } from 'claude-code/testing'

import { dragTo, pack, walk } from '../hooks/pad'

const run = (args: string) => ({ command: 'splat', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } }) as const

test('/splat without a file answers the usage line', async $ => {
  const ran = await $.command.run(run(''))
  expect(ran.text).toContain('Usage: /splat')
})

test('/splat with a missing file says so and starts nothing', async ($, on) => {
  on('env.get', async () => ({ value: '/home/someone' }))
  on('session.cwd', async () => ({ value: '/work' }))
  on('fs.stat', async () => { throw new Error('ENOENT') })
  on('process.spawn', async function* () { throw new Error('must not spawn') })
  const ran = await $.command.run(run('nope.ply'))
  expect(ran.text).toContain('not a file: /work/nope.ply')
})

test('a splat path in a prompt becomes an offer when the file exists', async ($, on) => {
  const offers: unknown[] = []
  on('env.get', async () => ({ value: '/home/someone' }))
  on('session.cwd', async () => ({ value: '/work' }))
  on('fs.stat', async ($, e) => ({ value: { kind: e.path.endsWith('scene.spz') ? 'file' : 'other', size: 1, mtimeMs: 0, isLink: false } }))
  on('state.set', { plugin: '3dgs-view', key: 'offer' }, ($, e, next) => { offers.push(e.value); return next(e) })
  on('prompt.submit', async ($, e) => ({ text: e.text }))
  await $.prompt.submit({ text: 'look at mesh.ply then scans/scene.spz please', wait: false, origin: { kind: 'composer' } })
  expect(offers).toEqual(['/work/scans/scene.spz'])
})

test('a drag turns columns into azimuth and rows into clamped elevation; the right button pans', async () => {
  const cam = { az: 30, el: 20, px: 0, py: 0, pz: 0, mode: 'orbit' } as const
  expect(dragTo(cam, 'left', 10, 0)).toEqual({ ...cam, az: 15 })
  expect(dragTo(cam, 'left', 0, 100)).toEqual({ ...cam, el: 85 })
  expect(dragTo(cam, 'right', 10, 5)).toEqual({ ...cam, px: -0.1, py: 0.1 })
})

test('in look mode a drag turns the head the other way, so the world still follows the pointer', async () => {
  const cam = { az: 30, el: 20, px: 0, py: 0, pz: 0, mode: 'look' } as const
  expect(dragTo(cam, 'left', 10, 0)).toEqual({ ...cam, az: 45 })
  expect(dragTo(cam, 'left', 0, 100)).toEqual({ ...cam, el: -85 })
})

test('in look mode the eye walks along the ground the way it faces, and a right-drag slides it sideways', async () => {
  const cam = { az: 0, el: 20, px: 0, py: 0, pz: 0, mode: 'look' } as const
  expect(walk(cam, 1, 0)).toEqual({ ...cam, pz: -1 }) // facing -z at az 0
  expect(walk({ ...cam, az: 90 }, 1, 0)).toEqual({ ...cam, az: 90, px: -1, pz: 0 })
  expect(dragTo(cam, 'right', 10, 5)).toEqual({ ...cam, px: -0.1, py: 0.1 })
})

test('footer keys break into as few lines as fit the width, never one wider', async () => {
  const w = (n: number) => n
  expect(pack([10, 10, 10], w, 36, 3)).toEqual([[10, 10, 10]]) // 10 + 3 + 10 + 3 + 10 = 36
  expect(pack([10, 10, 10], w, 35, 3)).toEqual([[10, 10], [10]])
  expect(pack([40, 5], w, 30, 3)).toEqual([[40], [5]]) // an item wider than the line still gets a line of its own
})
