import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { EditorState, StateEffect, type Extension } from '@codemirror/state'
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  hoverTooltip,
  keymap,
  lineNumbers,
  rectangularSelection
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult
} from '@codemirror/autocomplete'
import { diagnosticCount, linter, lintGutter, lintKeymap, type Diagnostic } from '@codemirror/lint'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { java } from '@codemirror/lang-java'
import { tags } from '@lezer/highlight'
import { scriptBracketProblem } from '@core/compile/compile'
import {
  JAVA_KEYWORDS,
  RESERVED_CLASSES,
  SCRIPT_PRESETS,
  importInsertPos,
  javaClassCatalog,
  scriptClassName,
  targetKey,
  type JavaClassInfo
} from '@core/scriptApi'
import { javaPackage, type Target } from '@core/project'
import { api } from '../api'
import { L } from '../i18n'
import { useStore, type FlowNode } from '../store'

/** VS Code-like colours, defined as CSS variables (light/dark) in theme.css. */
const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.modifier, tags.operatorKeyword, tags.definitionKeyword, tags.moduleKeyword], color: 'var(--cm-keyword)' },
  { tag: [tags.typeName, tags.className, tags.annotation], color: 'var(--cm-type)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--cm-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--cm-number)' },
  { tag: [tags.lineComment, tags.blockComment], color: 'var(--cm-comment)', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--cm-function)' },
  { tag: [tags.variableName, tags.propertyName], color: 'var(--cm-variable)' },
  { tag: [tags.operator, tags.punctuation], color: 'var(--cm-punct)' }
])

const C = (id: string) => id.toUpperCase()

/** Code snippets: Java basics plus the loader's event-handler shapes. */
function snippets(target: Target): Completion[] {
  const fabric = target.loader === 'fabric' || target.loader === 'quilt'
  const list: Completion[] = [
    snippetCompletion('if (${condition}) {\n\t${}\n}', { label: 'if', type: 'keyword', detail: 'if (…) { … }' }),
    snippetCompletion('if (${condition}) {\n\t${}\n} else {\n\t\n}', { label: 'ifelse', type: 'keyword', detail: 'if … else' }),
    snippetCompletion('for (int ${i} = 0; ${i} < ${count}; ${i}++) {\n\t${}\n}', { label: 'for', type: 'keyword', detail: 'for (int i …)' }),
    snippetCompletion('for (${Type} ${item} : ${list}) {\n\t${}\n}', { label: 'foreach', type: 'keyword', detail: 'for (x : list)' }),
    snippetCompletion('while (${condition}) {\n\t${}\n}', { label: 'while', type: 'keyword', detail: 'while (…)' }),
    snippetCompletion('try {\n\t${}\n} catch (Exception ${e}) {\n\tNkwMod.LOGGER.error("failed", ${e});\n}', {
      label: 'try',
      type: 'keyword',
      detail: 'try … catch'
    }),
    snippetCompletion('NkwMod.LOGGER.info("${message}");', { label: 'log', type: 'function', detail: 'NkwMod.LOGGER.info(…)', boost: 2 }),
    snippetCompletion('@Override\npublic ${void} ${name}(${}) {\n\t\n}', { label: 'override', type: 'keyword', detail: '@Override method' })
  ]
  if (fabric)
    list.push(
      snippetCompletion('@Override\npublic void onInitialize() {\n\t${}\n}', { label: 'onInitialize', type: 'function', detail: 'ModInitializer', boost: 3 })
    )
  else
    list.push(
      snippetCompletion('@SubscribeEvent\npublic static void ${onEvent}(${EventType} event) {\n\t${}\n}', {
        label: 'subscribe',
        type: 'function',
        detail: '@SubscribeEvent handler',
        boost: 3
      })
    )
  for (const k of [...JAVA_KEYWORDS, 'String']) list.push({ label: k, type: 'keyword' })
  return list
}

/** The mod's own classes: same package, so no import is needed. */
function modMembers(cls: string, target: Target): Completion[] {
  const s = useStore.getState()
  const holder = target.loader === 'forge' || target.loader === 'neoforge'
  const ids = (types: string[]) =>
    s.nodes.filter((n) => types.includes(n.type ?? '') && !n.data.disabled && typeof n.data.id === 'string').map((n) => n.data.id as string)
  const field = (id: string, kind: string) => ({
    label: C(id) + (holder ? '.get()' : ''),
    type: 'constant',
    detail: kind,
    apply: C(id) + (holder ? '.get()' : '')
  })
  switch (cls) {
    case 'NkwMod':
      return [
        { label: 'MOD_ID', type: 'constant', detail: `String = "${s.meta?.modId ?? ''}"` },
        { label: 'LOGGER', type: 'constant', detail: 'Logger (LOGGER.info(…))' },
        snippetCompletion('id("${path}")', { label: 'id', type: 'method', detail: 'ResourceLocation of this mod' })
      ]
    case 'ModItems':
      return ids(['item', 'food', 'tool', 'armorPiece', 'musicDisc']).map((id) => field(id, 'Item'))
    case 'ModBlocks':
      return ids(['block', 'block3d']).map((id) => field(id, 'Block'))
    case 'ModSounds':
      return ids(['soundEvent']).map((id) => field(id, 'SoundEvent'))
    default:
      return []
  }
}

function completions(target: () => Target) {
  return (cx: CompletionContext): CompletionResult | null => {
    const tg = target()
    // ModItems.RUBY … / NkwMod.MOD_ID …
    const member = cx.matchBefore(/\b(NkwMod|ModItems|ModBlocks|ModSounds)\.\w*/)
    if (member) {
      const cls = member.text.slice(0, member.text.indexOf('.'))
      return { from: member.from + cls.length + 1, options: modMembers(cls, tg), validFor: /^[\w.()]*$/ }
    }
    // @Annotations
    const ann = cx.matchBefore(/@\w*/)
    if (ann) {
      const catalog = javaClassCatalog(tg)
      const opts: Completion[] = [{ label: 'Override', type: 'type' }]
      for (const c of catalog.filter((x) => ['SubscribeEvent', 'EventBusSubscriber', 'Mod'].includes(x.name))) {
        const text =
          c.name === 'Mod'
            ? 'Mod.EventBusSubscriber(modid = NkwMod.MOD_ID)'
            : c.name === 'EventBusSubscriber'
              ? 'EventBusSubscriber(modid = NkwMod.MOD_ID)'
              : c.name
        opts.push({ label: text, type: 'type', detail: c.fqcn, apply: (view, _c, from, to) => applyWithImport(view, from, to, text, c) })
      }
      return { from: ann.from + 1, options: opts, validFor: /^[\w.]*$/ }
    }
    const word = cx.matchBefore(/\w+/)
    if (!word && !cx.explicit) return null
    // inside a string or comment: nothing
    const before = cx.state.doc.lineAt(cx.pos)
    const textBefore = before.text.slice(0, cx.pos - before.from)
    if ((textBefore.match(/"/g)?.length ?? 0) % 2 === 1 || textBefore.includes('//')) return null
    const classes: Completion[] = javaClassCatalog(tg).map((c) => ({
      label: c.name,
      type: 'class',
      detail: c.fqcn.slice(0, c.fqcn.lastIndexOf('.')),
      info: L(c.doc),
      apply: (view: EditorView, _c: Completion, from: number, to: number) => applyWithImport(view, from, to, c.name, c)
    }))
    const own: Completion[] = ['NkwMod', 'ModItems', 'ModBlocks', 'ModSounds'].map((n) => ({ label: n, type: 'class', detail: 'this mod', boost: 1 }))
    return { from: word ? word.from : cx.pos, options: [...own, ...classes, ...snippets(tg)], validFor: /^\w*$/ }
  }
}

/** Inserts `text` and, if needed, the import line for the class (like an IDE's auto-import). */
function applyWithImport(view: EditorView, from: number, to: number, text: string, cls: JavaClassInfo) {
  const doc = view.state.doc.toString()
  const imp = importInsertPos(doc, cls.fqcn)
  const changes = [{ from, to, insert: text }]
  if (imp && imp.pos <= from) changes.unshift({ from: imp.pos, to: imp.pos, insert: imp.text })
  else if (imp) changes.push({ from: imp.pos, to: imp.pos, insert: imp.text })
  const shift = imp && imp.pos <= from ? imp.text.length : 0
  view.dispatch({ changes, selection: { anchor: from + shift + text.length } })
}

/** Hover a known class name → its package and what it is for. */
function classHover(target: () => Target) {
  return hoverTooltip((view, pos) => {
    const word = view.state.wordAt(pos)
    if (!word) return null
    const name = view.state.sliceDoc(word.from, word.to)
    const c = javaClassCatalog(target()).find((x) => x.name === name)
    if (!c) return null
    return {
      pos: word.from,
      end: word.to,
      above: true,
      create: () => {
        const dom = document.createElement('div')
        dom.className = 'cm-api-hover'
        const sig = document.createElement('code')
        sig.textContent = c.fqcn
        const doc = document.createElement('div')
        doc.textContent = L(c.doc)
        dom.append(sig, doc)
        return { dom }
      }
    }
  })
}

/** Signals that javac errors changed (they live outside the editor). */
const javacUpdated = StateEffect.define<null>()

function javaLinter(th: boolean, javaErrors: () => { line: number; message: string; severity: 'error' | 'warning' }[]) {
  return linter(
    (view) => {
      const text = view.state.doc.toString()
      const out: Diagnostic[] = []
      const lineRange = (n: number) => view.state.doc.line(Math.max(1, Math.min(n, view.state.doc.lines)))
      const bracket = scriptBracketProblem(text)
      if (bracket) {
        const l = lineRange(bracket.line)
        out.push({ from: l.from, to: l.to, severity: 'error', message: th ? bracket.th : bracket.en })
      }
      const cls = scriptClassName(text)
      if (!cls)
        out.push({
          from: 0,
          to: Math.min(text.length, 1),
          severity: 'error',
          message: th ? 'ต้องมี public class (เช่น public class MyScript { … })' : 'Declare a public class (e.g. public class MyScript { … })'
        })
      else if (RESERVED_CLASSES.has(cls)) {
        const at = text.indexOf(cls)
        out.push({
          from: at,
          to: at + cls.length,
          severity: 'error',
          message: th ? `ชื่อคลาส ${cls} ม็อดใช้อยู่แล้ว` : `${cls} is used by the generated mod — pick another name`
        })
      }
      // real javac errors from the last build / check
      for (const e of javaErrors()) {
        const l = lineRange(e.line)
        out.push({ from: l.from, to: l.to, severity: e.severity, message: `javac: ${e.message}`, source: 'javac' })
      }
      return out
    },
    // new javac results (from a build) re-run the checks
    { delay: 400, needsRefresh: (u) => u.transactions.some((tr) => tr.effects.some((e) => e.is(javacUpdated))) }
  )
}

function EditorBox({ node, target, tall }: { node: FlowNode; target: Target; tall?: boolean }) {
  const { i18n } = useTranslation()
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const targetRef = useRef(target)
  targetRef.current = target
  const [pos, setPos] = useState('1:1')
  const [problems, setProblems] = useState(0)
  const th = i18n.language === 'th'
  const cls = scriptClassName(String(node.data.code ?? ''))
  const javaErrors = useStore((s) => s.build.javaErrors)
  const mine = useMemo(() => javaErrors.filter((e) => e.cls === cls), [javaErrors, cls])
  const errorsRef = useRef(mine)
  errorsRef.current = mine

  useEffect(() => {
    const el = host.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let checkpointed = false
    const save = (code: string) => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (!checkpointed) (useStore.getState().checkpoint(), (checkpointed = true))
        useStore.getState().updateData(node.id, { code })
      }, 250)
    }
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(highlight),
      bracketMatching(),
      closeBrackets(),
      autocompletion({ override: [completions(() => targetRef.current)], icons: true, activateOnTyping: true }),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      lintGutter(),
      javaLinter(th, () => errorsRef.current),
      classHover(() => targetRef.current),
      java(),
      EditorState.tabSize.of(4),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
        indentWithTab
      ]),
      EditorView.updateListener.of((u) => {
        setProblems(diagnosticCount(u.state))
        if (u.docChanged) save(u.state.doc.toString())
        if (u.selectionSet || u.docChanged) {
          const head = u.state.selection.main.head
          const line = u.state.doc.lineAt(head)
          setPos(`${line.number}:${head - line.from + 1}`)
        }
      })
    ]
    const v = new EditorView({ parent: el, state: EditorState.create({ doc: String(node.data.code ?? ''), extensions }) })
    view.current = v
    return () => {
      if (timer) {
        clearTimeout(timer)
        useStore.getState().updateData(node.id, { code: v.state.doc.toString() })
      }
      v.destroy()
      view.current = null
    }
  }, [node.id, th])

  // text replaced from outside (an example was picked): show it
  useEffect(() => {
    const v = view.current
    const code = String(node.data.code ?? '')
    if (v && v.state.doc.toString() !== code && !v.hasFocus) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: code } })
  }, [node.data.code])

  // new javac results: re-run the checks so they show up
  useEffect(() => {
    const v = view.current
    if (v) v.dispatch({ effects: javacUpdated.of(null) })
  }, [mine])

  return (
    <div className={`script-editor${tall ? ' tall' : ''}`}>
      <div ref={host} className="script-cm" />
      <div className="script-status">
        <span>
          Java · {target.loader} {target.mc}
        </span>
        <span className="grow" />
        {cls && <span className="faint">{cls}.java</span>}
        <span className={problems ? 'bad' : 'ok'}>{problems ? `⚠ ${problems}` : '✓'}</span>
        <span>{pos}</span>
      </div>
    </div>
  )
}

/** Which targets a Script file is written for (none = all). */
export function ScriptTargets({ node }: { node: FlowNode }) {
  const { t } = useTranslation()
  const targets = useStore((s) => s.targets)
  const chosen = Array.isArray(node.data.targets) ? (node.data.targets as string[]) : []
  const toggle = (k: string) => {
    useStore.getState().checkpoint()
    useStore.getState().updateData(node.id, { targets: chosen.includes(k) ? chosen.filter((x) => x !== k) : [...chosen, k] })
  }
  return (
    <div className="field">
      <label>{t('script.targets')}</label>
      <div className="row script-targets">
        <button
          className={`chip${chosen.length ? '' : ' on'}`}
          onClick={() => (useStore.getState().checkpoint(), useStore.getState().updateData(node.id, { targets: [] }))}
        >
          {t('script.allTargets')}
        </button>
        {targets.map((tg) => {
          const k = targetKey(tg)
          return (
            <button key={k} className={`chip${chosen.includes(k) ? ' on' : ''}`} onClick={() => toggle(k)}>
              {tg.loader} {tg.mc}
            </button>
          )
        })}
      </div>
      <span className="hint">{t('script.targetsHint')}</span>
    </div>
  )
}

/** Java editor for Script nodes: highlighting, class completion with auto-import, hover docs, checks, javac errors. */
export function ScriptEditor({ node }: { node: FlowNode }) {
  const { t } = useTranslation()
  const [big, setBig] = useState(false)
  const projectTargets = useStore((s) => s.targets)
  const active = useStore((s) => s.activeTarget)
  const building = useStore((s) => s.build.running)
  const chosen = Array.isArray(node.data.targets) ? (node.data.targets as string[]) : []
  // suggestions / examples / checks follow the first chosen target, else the active one
  const target: Target = projectTargets.find((tg) => chosen.includes(targetKey(tg))) ??
    projectTargets[active] ??
    projectTargets[0] ?? { loader: 'fabric', mc: '1.21.1' }
  const appliesToActive = !chosen.length || chosen.includes(targetKey(projectTargets[active] ?? target))

  const applyPreset = (id: string) => {
    const preset = SCRIPT_PRESETS.find((p) => p.id === id)
    if (!preset) return
    const current = String(node.data.code ?? '').trim()
    // the untouched starter or another example can be replaced without asking
    const body = (code: string) => code.replace(/^package [\w.]+;/, '').trim()
    const pristine = !current || /public class MyScript \{\s*\}\s*$/.test(current) || SCRIPT_PRESETS.some((p) => body(p.code(target)) === body(current))
    if (!pristine && !window.confirm(t('script.replace'))) return
    useStore.getState().checkpoint()
    const meta = useStore.getState().meta
    const code = preset.code(target)
    useStore.getState().updateData(node.id, { code: meta ? code.replace(/^package mod;/, `package ${javaPackage(meta)};`) : code })
  }

  const check = async () => {
    const s = useStore.getState()
    const project = s.project()
    if (!project || building) return
    s.setBuild({ running: true, task: 'compileJava', logs: [], progress: { msg: t('script.checking') } })
    window.dispatchEvent(new CustomEvent('nkw:dock', { detail: 'console' }))
    try {
      const started = await api.startBuild(project, target, 'compileJava')
      if (!started) s.setBuild({ running: false, progress: null })
    } catch (e) {
      s.setBuild({ running: false, progress: null })
      s.toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true)
    }
  }

  const toolbar = (
    <div className="row script-tools">
      <select className="input grow" value="" onChange={(e) => applyPreset(e.target.value)} title={t('script.presetHint')}>
        <option value="">{t('script.preset', { target: `${target.loader} ${target.mc}` })}</option>
        {SCRIPT_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {L(p.title)}
          </option>
        ))}
      </select>
      <button className="btn" onClick={() => void check()} disabled={building} title={t('script.checkHint', { target: `${target.loader} ${target.mc}` })}>
        {t('script.check')}
      </button>
      <button className="btn" onClick={() => setBig(!big)} title={big ? t('script.shrink') : t('script.expand')}>
        {big ? '⤡' : '⤢'}
      </button>
    </div>
  )

  return (
    <div className="field script-field">
      <label>{t('script.code')}</label>
      {toolbar}
      {!appliesToActive && <span className="hint warn">{t('script.notActive')}</span>}
      {!big && <EditorBox node={node} target={target} />}
      <span className="hint">{t('script.hint')}</span>
      {big &&
        createPortal(
          <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setBig(false)}>
            <div className="dialog script-modal" role="dialog" aria-modal>
              <div className="row">
                <b className="grow">☕ {scriptClassName(String(node.data.code ?? '')) ?? 'Script'}.java</b>
                <button className="btn" onClick={() => setBig(false)}>
                  {t('script.close')}
                </button>
              </div>
              {toolbar}
              <EditorBox node={node} target={target} tall />
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
