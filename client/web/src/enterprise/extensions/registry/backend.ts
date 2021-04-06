import { Observable, of } from 'rxjs'
import { map, mapTo, switchMap } from 'rxjs/operators'
import { gql } from '@sourcegraph/shared/src/graphql/graphql'
import * as GQL from '@sourcegraph/shared/src/graphql/schema'
import { createAggregateError } from '@sourcegraph/shared/src/util/errors'
import { queryGraphQL, requestGraphQL } from '../../../backend/graphql'
import { DeleteRegistryExtensionResult, DeleteRegistryExtensionVariables, Scalars } from '../../../graphql-operations'

export function deleteRegistryExtensionWithConfirmation(extension: Scalars['ID']): Observable<boolean> {
    return of(window.confirm('Really delete this extension from the extension registry?')).pipe(
        switchMap(wasConfirmed => {
            if (!wasConfirmed) {
                return [false]
            }
            return requestGraphQL<DeleteRegistryExtensionResult, DeleteRegistryExtensionVariables>(
                gql`
                    mutation DeleteRegistryExtension($extension: ID!) {
                        extensionRegistry {
                            deleteExtension(extension: $extension) {
                                alwaysNil
                            }
                        }
                    }
                `,
                { extension }
            ).pipe(
                map(({ data, errors }) => {
                    if (!data?.extensionRegistry?.deleteExtension || (errors && errors.length > 0)) {
                        throw createAggregateError(errors)
                    }
                }),
                mapTo(true)
            )
        })
    )
}

export function queryViewerRegistryPublishers(): Observable<GQL.RegistryPublisher[]> {
    return queryGraphQL(gql`
        query ViewerRegistryPublishers {
            extensionRegistry {
                viewerPublishers {
                    __typename
                    ... on User {
                        id
                        username
                    }
                    ... on Org {
                        id
                        name
                    }
                }
                localExtensionIDPrefix
            }
        }
    `).pipe(
        map(({ data, errors }) => {
            if (!data?.extensionRegistry?.viewerPublishers || (errors && errors.length > 0)) {
                throw createAggregateError(errors)
            }
            return data.extensionRegistry.viewerPublishers.map(publisher => ({
                ...publisher,
                extensionIDPrefix: data.extensionRegistry.localExtensionIDPrefix || undefined,
            }))
        })
    )
}
