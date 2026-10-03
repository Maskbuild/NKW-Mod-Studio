import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers } from '@codemirror/view'
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { java } from '@codemirror/lang-java'
import { json } from '@codemirror/lang-json'
import { overrideKey } from '@core/project'
import { highlight } from '../graph/ScriptEditor'
import { useStore } from '../store'
import { useIde } from './ideStore'

const language = (path: string) => (path.endsWith('.java') ? java() : /\.(json|mcmeta)$/.test(path) ? json() : [])

/**
 * A generated file with highlighting, folding and search (Ctrl+F). Text files can be edited: the edit is
 * kept in the project and used instead of the generated text when building, until it is reverted.
 */
export function CodeView({ path }: { path: string }) {
  const { t } = useTranslation()
  const file = useIde((s) => s.files.find((f) => f.path === path))
  const target = useStore((s) => s.targets[s.activeTarget])
  const key = target ? overrideKey(target, path) : null
  const override = useStore((s) => (key ? s.overrides[key] : undefined))
  const edited = override !== undefined
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const lang = useRef(new Compartment())
  const readOnly = useRef(new Compartment())
  // what typing compares against: the generator's own text
  const baseline = useRef<string>('')
  const keyRef = useRef(key)
  keyRef.current = key

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: '',
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          foldGutter(),
          drawSelection(),
          history(),
          indentOnInput(),
          closeBrackets(),
          syntaxHighlighting(highlight),
          bracketMatching(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          EditorState.tabSize.of(4),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
          lang.current.of([]),
          readOnly.current.of(EditorState.readOnly.of(true)),
          EditorView.updateListener.of((u) => {
            if (u.selectionSet || u.docChanged) {
              const pos = u.state.selection.main.head
              const line = u.state.doc.lineAt(pos)
              useIde.setState({ cursor: { line: line.number, col: pos - line.from + 1 } })
            }
            // typed changes become an override (back to the generated text = no override)
            if (
              u.docChanged &&
              u.transactions.some(
                (tr) => tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('undo') || tr.isUserEvent('redo') || tr.isUserEvent('move')
              )
            ) {
              clearTimeout(timer)
              const text = u.state.doc.toString()
              timer = setTimeout(() => {
                const k = keyRef.current
                if (k) useStore.getState().setOverride(k, text === baseline.current ? null : text)
              }, 300)
            }
          })
        ]
      })
    })
    view.current = v
    return () => {
      clearTimeout(timer)
      v.destroy()
    }
  }, [])

  // show the file: on a new path, or when it changed and the user is not editing it
  const shown = useRef<string | null>(null)
  useEffect(() => {
    const v = view.current
    if (!v) return
    // an edited file shows the saved edit (the file list may be older than the last keystrokes)
    const text = override ?? file?.text ?? (file ? t('ide.binary') : t('ide.gone'))
    // the generator's own text: kept apart when the preview already holds the edit
    baseline.current = file?.generated ?? file?.text ?? ''
    const samePath = shown.current === path
    if (samePath && (edited || v.state.doc.toString() === text)) return
    const top = samePath ? v.scrollDOM.scrollTop : 0
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: text },
      effects: [lang.current.reconfigure(language(path)), readOnly.current.reconfigure(EditorState.readOnly.of(!file || file.text === null))]
    })
    v.scrollDOM.scrollTop = top
    shown.current = path
  }, [file, path, t, edited])

  const revert = () => {
    if (!key) return
    useStore.getState().setOverride(key, null)
    shown.current = null
    void useIde.getState().refreshFiles()
  }

  return (
    <div className="code-view">
      <div className="crumbs mono">{path.split('/').join(' › ')}</div>
      {edited && (
        <div className="code-edited">
          <span className="grow">✎ {t('ide.edited')}</span>
          <button className="btn small" onClick={revert}>
            {t('ide.revert')}
          </button>
        </div>
      )}
      <div className="code-host" ref={host} />
    </div>
  )
}
