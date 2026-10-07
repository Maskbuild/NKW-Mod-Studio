import { useEffect, useRef, useState } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import { bracketMatching, foldGutter, foldKeymap, syntaxHighlighting } from '@codemirror/language'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { json } from '@codemirror/lang-json'
import { highlight } from '../components/highlight'

/**
 * JSON in a code editor (like VS Code's settings.json). Read-only unless `onChange` is given; then valid
 * JSON is handed over as the user types, and the error of the last attempt (if any) is shown.
 */
export function JsonView({ value, onChange, height }: { value: unknown; onChange?: (v: unknown) => Promise<string | null>; height?: number | string }) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const ro = useRef(new Compartment())
  const [error, setError] = useState<string | null>(null)
  const editing = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const text = JSON.stringify(value, null, 2)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(),
          foldGutter(),
          drawSelection(),
          history(),
          closeBrackets(),
          bracketMatching(),
          highlightActiveLine(),
          syntaxHighlighting(highlight),
          json(),
          EditorState.tabSize.of(2),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
          ro.current.of(EditorState.readOnly.of(!onChange)),
          EditorView.updateListener.of((u) => {
            if (u.focusChanged) editing.current = u.view.hasFocus
            if (
              !u.docChanged ||
              !onChangeRef.current ||
              !u.transactions.some((tr) => tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('undo') || tr.isUserEvent('redo'))
            )
              return
            clearTimeout(timer)
            const doc = u.state.doc.toString()
            timer = setTimeout(async () => {
              let parsed: unknown
              try {
                parsed = JSON.parse(doc)
              } catch (e) {
                setError((e as Error).message)
                return
              }
              setError((await onChangeRef.current?.(parsed)) ?? null)
            }, 500)
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

  // changes made elsewhere (the form) show up, unless the user is typing here
  useEffect(() => {
    const v = view.current
    if (!v || editing.current || v.state.doc.toString() === text) return
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } })
  }, [text])

  return (
    <div className="json-view">
      <div className="json-host" ref={host} style={{ height: height ?? '100%' }} />
      {error && <div className="hint warn mono">{error}</div>}
    </div>
  )
}
