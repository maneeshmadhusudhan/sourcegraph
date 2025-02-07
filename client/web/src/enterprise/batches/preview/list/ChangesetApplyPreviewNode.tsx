import React from 'react'

import * as H from 'history'

import { ChangesetApplyPreviewFields } from '../../../../graphql-operations'
import { PreviewPageAuthenticatedUser } from '../BatchChangePreviewPage'

import { queryChangesetSpecFileDiffs } from './backend'
import { HiddenChangesetApplyPreviewNode } from './HiddenChangesetApplyPreviewNode'
import { VisibleChangesetApplyPreviewNode } from './VisibleChangesetApplyPreviewNode'

import styles from './ChangesetApplyPreviewNode.module.scss'

export interface ChangesetApplyPreviewNodeProps {
    node: ChangesetApplyPreviewFields
    history: H.History
    location: H.Location
    authenticatedUser: PreviewPageAuthenticatedUser
    selectable?: {
        onSelect: (id: string) => void
        isSelected: (id: string) => boolean
    }

    /** Used for testing. */
    queryChangesetSpecFileDiffs?: typeof queryChangesetSpecFileDiffs
    /** Expand changeset descriptions, for testing only. */
    expandChangesetDescriptions?: boolean
}

export const ChangesetApplyPreviewNode: React.FunctionComponent<
    React.PropsWithChildren<ChangesetApplyPreviewNodeProps>
> = ({ node, queryChangesetSpecFileDiffs, expandChangesetDescriptions, ...props }) => (
    <li className={styles.changesetApplyPreviewNode}>
        <span className={styles.changesetApplyPreviewNodeSeparator} />
        {node.__typename === 'HiddenChangesetApplyPreview' ? (
            <HiddenChangesetApplyPreviewNode node={node} />
        ) : (
            <VisibleChangesetApplyPreviewNode
                node={node}
                {...props}
                queryChangesetSpecFileDiffs={queryChangesetSpecFileDiffs}
                expandChangesetDescriptions={expandChangesetDescriptions}
            />
        )}
    </li>
)
