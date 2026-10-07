import { HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'

/** VS Code-like colours for the code and JSON views, defined as CSS variables (light/dark) in theme.css. */
export const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.modifier, tags.operatorKeyword, tags.definitionKeyword, tags.moduleKeyword], color: 'var(--cm-keyword)' },
  { tag: [tags.typeName, tags.className, tags.annotation], color: 'var(--cm-type)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--cm-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--cm-number)' },
  { tag: [tags.lineComment, tags.blockComment], color: 'var(--cm-comment)', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--cm-function)' },
  { tag: [tags.variableName, tags.propertyName], color: 'var(--cm-variable)' },
  { tag: [tags.operator, tags.punctuation], color: 'var(--cm-punct)' }
])
