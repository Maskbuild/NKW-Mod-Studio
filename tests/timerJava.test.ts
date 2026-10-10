import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { timerDocJava, timerLayoutJava } from '../src/core/gen/timerJava'
import { TIMER_PRESETS, TimerDocSchema, legacyToDoc, resolveLayout, type DrawCmd, type LayoutInput, type TimerDoc } from '../src/core/timerUi'

const hasJdk = spawnSync('javac', ['-version']).status === 0

/** a small deterministic random generator */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function randomDoc(seed: number): TimerDoc {
  const r = rng(seed)
  const pick = <T>(a: readonly T[]) => a[Math.floor(r() * a.length)]
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const color = () => `#${int(0, 0xffffff).toString(16).padStart(6, '0')}`
  const fill = () =>
    r() < 0.5
      ? { kind: 'solid', color: color(), alpha: int(0, 100) }
      : { kind: 'linear', color: color(), to: color(), vertical: r() < 0.5, alpha: int(20, 100), alphaTo: int(0, 100) }
  const anim = () => {
    const prop = pick(['opacity', 'x', 'y', 'scale', 'color'] as const)
    const common = {
      trigger: pick(['time', 'progress', 'low'] as const),
      ticks: int(1, 60),
      delay: int(0, 20),
      ease: pick(['linear', 'in', 'out', 'inOut'] as const),
      loop: pick(['once', 'repeat', 'pingpong'] as const)
    }
    if (prop === 'color') return { prop, from: color(), to: color(), ...common }
    if (prop === 'opacity') return { prop, from: int(0, 100), to: int(0, 100), ...common }
    if (prop === 'scale') return { prop, from: 1, to: 0.5 + r() * 1.5, ...common }
    return { prop, from: 0, to: r() * 30 - 15, ...common }
  }
  const element = (i: number) => {
    const base = {
      id: `e${i}`,
      anchor: pick(['topLeft', 'top', 'topRight', 'left', 'center', 'right', 'bottomLeft', 'bottom', 'bottomRight'] as const),
      x: int(-20, 20) + (r() < 0.3 ? 0.5 : 0),
      y: int(-20, 20),
      w: int(2, 90),
      h: int(2, 30),
      opacity: int(30, 100),
      show: pick(['always', 'always', 'harvest', 'mining', 'low'] as const),
      anims: Array.from({ length: int(0, 3) }, anim)
    }
    switch (int(0, 4)) {
      case 0:
        return { ...base, type: 'rect', fill: fill(), ...(r() < 0.5 ? { border: { width: int(1, 3), color: color(), alpha: int(0, 100) } } : {}) }
      case 1:
        return {
          ...base,
          type: 'bar',
          fill: fill(),
          back: r() < 0.7 ? fill() : null,
          pad: int(0, 3),
          dir: pick(['ltr', 'rtl', 'ttb', 'btt'] as const),
          ...(r() < 0.3 ? { border: { width: 1, color: color(), alpha: 80 } } : {})
        }
      case 2:
        return {
          ...base,
          type: 'ring',
          fill: fill(),
          back: r() < 0.7 ? fill() : null,
          radius: int(3, 20),
          thickness: int(1, 22),
          start: int(0, 359),
          cw: r() < 0.7
        }
      case 3:
        return {
          ...base,
          type: 'text',
          text: pick(['{seconds} s', '{percent}% {bar}', 'Hi {bar}']),
          textTh: r() < 0.5 ? 'เหลือ {seconds}' : undefined,
          color: color(),
          shadow: r() < 0.5,
          scale: pick([1, 1, 1.5, 2]),
          align: pick(['left', 'center', 'right'] as const)
        }
      default:
        return { ...base, type: 'image', asset: 'textures/x.png', tint: r() < 0.5 ? color() : null }
    }
  }
  return TimerDocSchema.parse({
    v: 2,
    place: {
      at: pick(['crosshair', 'hotbar', 'top', 'center', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const),
      x: int(-10, 10),
      y: int(-10, 10)
    },
    size: { w: int(20, 120), h: int(8, 60) },
    elements: Array.from({ length: int(1, 6) }, (_, i) => element(i))
  })
}

const INPUTS: LayoutInput[] = []
for (const [sw, sh] of [
  [427, 240],
  [640, 361]
])
  for (const progress of [0, 0.37, 1])
    for (const mode of ['harvest', 'mining'] as const)
      for (const [ticksLeft, time, lang] of [
        [100, 0, 'en'],
        [30, 3.5, 'th'],
        [0, 17, 'en'],
        [59.5, 100.25, 'en']
      ] as const)
        INPUTS.push({ screen: { w: sw, h: sh }, mode, progress, ticksLeft, time, lang })

const fmt = (c: DrawCmd): string =>
  c.k === 'rect'
    ? `R ${c.x1} ${c.y1} ${c.x2} ${c.y2} ${c.argb | 0}`
    : c.k === 'text'
      ? `T ${c.el} ${c.x} ${c.y} ${c.align} ${c.argb | 0} ${c.shadow ? 1 : 0} ${Number.isInteger(c.scale) ? c.scale.toFixed(1) : c.scale} ${c.text}`
      : `I ${c.el} ${c.x} ${c.y} ${c.w} ${c.h} ${c.argb | 0} ${c.asset}`

describe.skipIf(!hasJdk)('the Java layout draws what the TypeScript layout draws', () => {
  it('matches on presets, old settings and random documents', () => {
    const docs: TimerDoc[] = [
      ...TIMER_PRESETS.map((p) => p.doc()),
      legacyToDoc({ style: 'bar', place: 'hotbar', offset: -12, width: 81, height: 7 }),
      legacyToDoc({ style: 'ring', radius: 11, thickness: 5 }),
      legacyToDoc({ style: 'text', time: false }),
      ...Array.from({ length: 24 }, (_, i) => randomDoc(1000 + i))
    ]
    const dir = mkdtempSync(join(tmpdir(), 'nkw-timer-'))
    const pkg = 'timertest'
    mkdirSync(join(dir, pkg))
    writeFileSync(join(dir, pkg, 'NkwTimerLayout.java'), timerLayoutJava(pkg))
    const methods = docs.map((d, i) => `    static Doc doc${i}() {\n${timerDocJava(d, (a) => a)}\n    }`).join('\n')
    const inputs = INPUTS.map(
      (i) => `{ ${i.screen.w}, ${i.screen.h}, ${i.mode === 'harvest' ? 1 : 0}, ${i.lang === 'th' ? 1 : 0}, ${i.progress}, ${i.ticksLeft}, ${i.time} }`
    ).join(',\n            ')
    writeFileSync(
      join(dir, pkg, 'Harness.java'),
      `package ${pkg};
import ${pkg}.NkwTimerLayout.*;
import java.util.List;
public class Harness {
${methods}
    public static void main(String[] args) {
        Doc[] docs = { ${docs.map((_, i) => `doc${i}()`).join(', ')} };
        double[][] inputs = {
            ${inputs}
        };
        for (int d = 0; d < docs.length; d++) {
            for (int k = 0; k < inputs.length; k++) {
                In in = new In();
                in.sw = (int) inputs[k][0]; in.sh = (int) inputs[k][1]; in.harvest = inputs[k][2] == 1; in.th = inputs[k][3] == 1;
                in.progress = inputs[k][4]; in.ticksLeft = inputs[k][5]; in.time = inputs[k][6];
                boolean th = in.th;
                List<Cmd> cmds = NkwTimerLayout.layout(docs[d], d, in, (di, ei, e) -> th && !e.textTh.isEmpty() ? e.textTh : e.text);
                System.out.println("#" + d + " " + k);
                for (Cmd c : cmds) {
                    if (c.kind == NkwTimerLayout.C_RECT) System.out.println("R " + c.x1 + " " + c.y1 + " " + c.x2 + " " + c.y2 + " " + c.argb);
                    else if (c.kind == NkwTimerLayout.C_TEXT) System.out.println("T " + c.el + " " + c.x1 + " " + c.y1 + " " + c.align + " " + c.argb + " " + (c.shadow ? 1 : 0) + " " + c.scale + " " + c.text);
                    else System.out.println("I " + c.el + " " + c.x1 + " " + c.y1 + " " + c.w + " " + c.h + " " + c.argb + " " + c.asset);
                }
            }
        }
    }
}
`
    )
    const classes = join(dir, 'classes')
    mkdirSync(classes)
    execFileSync('javac', ['-encoding', 'UTF-8', '-Xlint:all', '-d', classes, join(dir, pkg, 'NkwTimerLayout.java'), join(dir, pkg, 'Harness.java')], {
      stdio: 'pipe'
    })
    const javaOut = execFileSync('java', ['-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-cp', classes, `${pkg}.Harness`], {
      encoding: 'utf8',
      maxBuffer: 1 << 28
    })
    const ts: string[] = []
    docs.forEach((doc, d) =>
      INPUTS.forEach((inp, k) => {
        ts.push(`#${d} ${k}`)
        for (const c of resolveLayout(doc, inp)) ts.push(fmt(c))
      })
    )
    const j = javaOut.split(/\r?\n/).filter((l) => l.length)
    expect(j.length).toBe(ts.length)
    for (let i = 0; i < ts.length; i++) if (j[i] !== ts[i]) throw new Error(`line ${i}: java "${j[i]}" vs ts "${ts[i]}"`)
    expect(ts.filter((l) => l.startsWith('R ')).length).toBeGreaterThan(1000)
  }, 120_000)
})
