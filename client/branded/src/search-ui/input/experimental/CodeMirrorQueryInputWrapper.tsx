import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { defaultKeymap, historyKeymap, history as codemirrorHistory } from '@codemirror/commands'
import { Compartment, EditorState, Extension, Prec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { mdiClose } from '@mdi/js'
import classNames from 'classnames'
import inRange from 'lodash/inRange'
import { useNavigate } from 'react-router-dom-v5-compat'
import useResizeObserver from 'use-resize-observer'
import * as uuid from 'uuid'

import { HistoryOrNavigate } from '@sourcegraph/common'
import { SearchPatternType } from '@sourcegraph/shared/src/graphql-operations'
import { Shortcut } from '@sourcegraph/shared/src/react-shortcuts'
import { QueryChangeSource, QueryState } from '@sourcegraph/shared/src/search'
import { Icon } from '@sourcegraph/wildcard'

import { singleLine, placeholder as placeholderExtension } from '../codemirror'
import { parseInputAsQuery, tokens } from '../codemirror/parsedQuery'
import { querySyntaxHighlighting } from '../codemirror/syntax-highlighting'

import { filterHighlight } from './codemirror/syntax-highlighting'
import { editorConfigFacet, Source, suggestions } from './suggestionsExtension'

import styles from './CodeMirrorQueryInputWrapper.module.scss'

interface ExtensionConfig {
    popoverID: string
    patternType: SearchPatternType
    interpretComments: boolean
    isLightTheme: boolean
    placeholder: string
    onChange: (querySate: QueryState) => void
    onSubmit?: () => void
    suggestionsContainer: HTMLDivElement | null
    suggestionSource?: Source
    historyOrNavigate: HistoryOrNavigate
}

// We want to show a placeholder also if the query only contains a context
// filter.
function showWhenEmptyWithoutContext(state: EditorState): boolean {
    // Show placeholder when empty
    if (state.doc.length === 0) {
        return true
    }

    const queryTokens = tokens(state)

    if (queryTokens.length > 2) {
        return false
    }
    // Only show the placeholder if the cursor is at the end of the content
    if (state.selection.main.from !== state.doc.length) {
        return false
    }

    // If there are two tokens, only show the placeholder if the second one is a
    // whitespace.
    if (queryTokens.length === 2 && queryTokens[1].type !== 'whitespace') {
        return false
    }

    return (
        queryTokens.length > 0 &&
        queryTokens[0].type === 'filter' &&
        queryTokens[0].field.value === 'context' &&
        !inRange(state.selection.main.from, queryTokens[0].range.start, queryTokens[0].range.end + 1)
    )
}

// For simplicity we will recompute all extensions when input changes using
// this ocmpartment
const extensionsCompartment = new Compartment()

// Helper function to update extensions dependent on props. Used when
// creating the editor and to update it when the props change.
function configureExtensions({
    popoverID,
    patternType,
    interpretComments,
    isLightTheme,
    placeholder,
    onChange,
    onSubmit,
    suggestionsContainer,
    suggestionSource,
    historyOrNavigate,
}: ExtensionConfig): Extension {
    const extensions = [
        singleLine,
        EditorView.darkTheme.of(isLightTheme === false),
        parseInputAsQuery({ patternType, interpretComments }),
        EditorView.updateListener.of(update => {
            if (update.docChanged) {
                onChange({
                    query: update.state.sliceDoc(),
                    changeSource: QueryChangeSource.userInput,
                })
            }
        }),
    ]

    if (placeholder) {
        extensions.push(placeholderExtension(placeholder, showWhenEmptyWithoutContext))
    }

    if (onSubmit) {
        extensions.push(
            editorConfigFacet.of({ onSubmit }),
            Prec.high(
                keymap.of([
                    {
                        key: 'Enter',
                        run() {
                            onSubmit()
                            return true
                        },
                    },
                    {
                        key: 'Mod-Enter',
                        run() {
                            onSubmit()
                            return true
                        },
                    },
                ])
            )
        )
    }

    if (suggestionSource && suggestionsContainer) {
        extensions.push(suggestions(popoverID, suggestionsContainer, suggestionSource, historyOrNavigate))
    }

    return extensions
}

function createEditor(
    parent: HTMLDivElement,
    popoverID: string,
    queryState: QueryState,
    extensions: Extension
): EditorView {
    return new EditorView({
        state: EditorState.create({
            doc: queryState.query,
            selection: { anchor: queryState.query.length },
            extensions: [
                EditorView.lineWrapping,
                EditorView.contentAttributes.of({
                    role: 'combobox',
                    'aria-controls': popoverID,
                    'aria-owns': popoverID,
                    'aria-haspopup': 'grid',
                }),
                keymap.of(historyKeymap),
                keymap.of(defaultKeymap),
                codemirrorHistory(),
                Prec.low([querySyntaxHighlighting, filterHighlight]),
                EditorView.theme({
                    '&': {
                        flex: 1,
                        backgroundColor: 'var(--input-bg)',
                        borderRadius: 'var(--border-radius)',
                        borderColor: 'var(--border-color)',
                    },
                    '&.cm-editor.cm-focused': {
                        outline: 'none',
                    },
                    '.cm-content': {
                        caretColor: 'var(--search-query-text-color)',
                        fontFamily: 'var(--code-font-family)',
                        fontSize: 'var(--code-font-size)',
                        color: 'var(--search-query-text-color)',
                    },
                }),
                extensionsCompartment.of(extensions),
            ],
        }),
        parent,
    })
}

function updateEditor(editor: EditorView | null, extensions: Extension): void {
    if (editor) {
        editor.dispatch({ effects: extensionsCompartment.reconfigure(extensions) })
    }
}

function updateValueIfNecessary(editor: EditorView | null, queryState: QueryState): void {
    if (editor && queryState.changeSource !== QueryChangeSource.userInput) {
        editor.dispatch({
            changes: { from: 0, to: editor.state.doc.length, insert: queryState.query },
            selection: { anchor: queryState.query.length },
        })
    }
}

export interface CodeMirrorQueryInputWrapperProps {
    queryState: QueryState
    onChange: (queryState: QueryState) => void
    onSubmit: () => void
    isLightTheme: boolean
    interpretComments: boolean
    patternType: SearchPatternType
    placeholder: string
    suggestionSource: Source
}

export const CodeMirrorQueryInputWrapper: React.FunctionComponent<CodeMirrorQueryInputWrapperProps> = ({
    queryState,
    onChange,
    onSubmit,
    isLightTheme,
    interpretComments,
    patternType,
    placeholder,
    suggestionSource,
}) => {
    const navigate = useNavigate()
    const [container, setContainer] = useState<HTMLDivElement | null>(null)
    const focusContainerRef = useRef<HTMLDivElement | null>(null)
    const [suggestionsContainer, setSuggestionsContainer] = useState<HTMLDivElement | null>(null)
    const popoverID = useMemo(() => uuid.v4(), [])

    // Wraps the onSubmit prop because that one changes whenever the input
    // value changes causing unnecessary reconfiguration of the extensions
    const onSubmitRef = useRef(onSubmit)
    onSubmitRef.current = onSubmit
    const hasSubmitHandler = !!onSubmit

    // Update extensions whenever any of these props change
    const extensions = useMemo(
        () =>
            configureExtensions({
                popoverID,
                patternType,
                interpretComments,
                isLightTheme,
                placeholder,
                onChange,
                onSubmit: hasSubmitHandler ? (): void => onSubmitRef.current?.() : undefined,
                suggestionsContainer,
                suggestionSource,
                historyOrNavigate: navigate,
            }),
        [
            popoverID,
            patternType,
            interpretComments,
            isLightTheme,
            placeholder,
            onChange,
            hasSubmitHandler,
            onSubmitRef,
            suggestionsContainer,
            suggestionSource,
            navigate,
        ]
    )

    const editor = useMemo(
        () => (container ? createEditor(container, popoverID, queryState, extensions) : null),
        // Should only run once when the component is created, not when
        // extensions for state update (this is handled in separate hooks)
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [container]
    )
    const editorRef = useRef(editor)
    editorRef.current = editor
    useEffect(() => () => editor?.destroy(), [editor])

    // Update editor content whenever query state changes
    useEffect(() => updateValueIfNecessary(editorRef.current, queryState), [queryState])

    // Update editor configuration whenever extensions change
    useEffect(() => updateEditor(editorRef.current, extensions), [extensions])

    const focus = useCallback(() => {
        editorRef.current?.contentDOM.focus()
    }, [editorRef])

    const clear = useCallback(() => {
        onChange({ query: '' })
    }, [onChange])

    const { ref: spacerRef, height: spacerHeight } = useResizeObserver({
        ref: focusContainerRef,
    })

    const hasValue = queryState.query.length > 0

    return (
        <div className={styles.container}>
            {/* eslint-disable-next-line react/forbid-dom-props */}
            <div className={styles.spacer} style={{ height: `${spacerHeight}px` }} />
            <div className={styles.root}>
                <div ref={spacerRef} className={styles.focusContainer}>
                    <div ref={setContainer} className="d-contents" />
                    <button
                        type="button"
                        className={classNames(styles.inputButton, { [styles.showWhenFocused]: hasValue })}
                        onClick={clear}
                    >
                        <Icon svgPath={mdiClose} aria-label="Clear" />
                    </button>
                    <button
                        type="button"
                        className={classNames(styles.inputButton, styles.globalShortcut, styles.hideWhenFocused)}
                        onClick={focus}
                    >
                        /
                    </button>
                </div>
                <div ref={setSuggestionsContainer} className={styles.suggestions} />
            </div>
            <Shortcut ordered={['/']} onMatch={focus} />
        </div>
    )
}
