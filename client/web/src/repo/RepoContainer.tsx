import React, { Suspense, useEffect, useMemo, useState } from 'react'

import { mdiSourceRepository } from '@mdi/js'
import classNames from 'classnames'
import * as H from 'history'
import { escapeRegExp } from 'lodash'
import MapSearchIcon from 'mdi-react/MapSearchIcon'
import { matchPath, Route, Switch } from 'react-router'
import { useLocation } from 'react-router-dom-v5-compat'
import { NEVER, of } from 'rxjs'
import { catchError, switchMap } from 'rxjs/operators'

import { StreamingSearchResultsListProps } from '@sourcegraph/branded'
import { asError, encodeURIPathComponent, ErrorLike, isErrorLike, logger, repeatUntil } from '@sourcegraph/common'
import {
    isCloneInProgressErrorLike,
    isRepoSeeOtherErrorLike,
    isRevisionNotFoundErrorLike,
} from '@sourcegraph/shared/src/backend/errors'
import { RepoQuestionIcon } from '@sourcegraph/shared/src/components/icons'
import { displayRepoName } from '@sourcegraph/shared/src/components/RepoLink'
import { ExtensionsControllerProps } from '@sourcegraph/shared/src/extensions/controller'
import { PlatformContextProps } from '@sourcegraph/shared/src/platform/context'
import { Settings } from '@sourcegraph/shared/src/schema/settings.schema'
import { SearchContextProps } from '@sourcegraph/shared/src/search'
import { escapeSpaces } from '@sourcegraph/shared/src/search/query/filters'
import { SettingsCascadeProps } from '@sourcegraph/shared/src/settings/settings'
import { TelemetryProps } from '@sourcegraph/shared/src/telemetry/telemetryService'
import { ThemeProps } from '@sourcegraph/shared/src/theme'
import { makeRepoURI } from '@sourcegraph/shared/src/util/url'
import { Button, Icon, Link, useObservable } from '@sourcegraph/wildcard'

import { AuthenticatedUser } from '../auth'
import { BatchChangesProps } from '../batches'
import { CodeIntelligenceProps } from '../codeintel'
import { BreadcrumbSetters, BreadcrumbsProps } from '../components/Breadcrumbs'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { HeroPage } from '../components/HeroPage'
import { ActionItemsBarProps, useWebActionItems } from '../extensions/components/ActionItemsBar'
import { ExternalLinkFields, RepositoryFields } from '../graphql-operations'
import { CodeInsightsProps } from '../insights/types'
import { NotebookProps } from '../notebooks'
import { searchQueryForRepoRevision, SearchStreamingProps } from '../search'
import { useNavbarQueryState } from '../stores'
import { RouteDescriptor } from '../util/contributions'
import { parseBrowserRepoURL } from '../util/url'

import { GoToCodeHostAction } from './actions/GoToCodeHostAction'
import { fetchFileExternalLinks, ResolvedRevision, resolveRepoRevision } from './backend'
import { RepoContainerError } from './RepoContainerError'
import { RepoHeader, RepoHeaderActionButton, RepoHeaderContributionsLifecycleProps } from './RepoHeader'
import { RepoHeaderContributionPortal } from './RepoHeaderContributionPortal'
import {
    RepoRevisionContainer,
    RepoRevisionContainerContext,
    RepoRevisionContainerRoute,
} from './RepoRevisionContainer'
import { commitsPath, compareSpecPath } from './routes'
import { RepoSettingsAreaRoute } from './settings/RepoSettingsArea'
import { RepoSettingsSideBarGroup } from './settings/RepoSettingsSidebar'

import { redirectToExternalHost } from '.'

import styles from './RepoContainer.module.scss'

/**
 * Props passed to sub-routes of {@link RepoContainer}.
 */
export interface RepoContainerContext
    extends RepoHeaderContributionsLifecycleProps,
        SettingsCascadeProps,
        ExtensionsControllerProps,
        PlatformContextProps,
        ThemeProps,
        HoverThresholdProps,
        TelemetryProps,
        Pick<SearchContextProps, 'selectedSearchContextSpec' | 'searchContextsEnabled'>,
        BreadcrumbSetters,
        ActionItemsBarProps,
        SearchStreamingProps,
        Pick<StreamingSearchResultsListProps, 'fetchHighlightedFileLineRanges'>,
        CodeIntelligenceProps,
        BatchChangesProps,
        CodeInsightsProps {
    repo: RepositoryFields
    repoName: string
    resolvedRevisionOrError: ResolvedRevision | ErrorLike | undefined
    authenticatedUser: AuthenticatedUser | null
    repoSettingsAreaRoutes: readonly RepoSettingsAreaRoute[]
    repoSettingsSidebarGroups: readonly RepoSettingsSideBarGroup[]

    /** The URL route match for {@link RepoContainer}. */
    routePrefix: string

    onDidUpdateExternalLinks: (externalLinks: ExternalLinkFields[] | undefined) => void

    globbing: boolean

    isMacPlatform: boolean

    isSourcegraphDotCom: boolean
}

/**
 * Props passed to sub-routes of {@link RepoContainer} which are specific to repository settings.
 */
export interface RepoSettingsContainerContext extends Omit<RepoContainerContext, 'repo' | 'resolvedRevisionOrError'> {}

/** A sub-route of {@link RepoContainer}. */
export interface RepoContainerRoute extends RouteDescriptor<RepoContainerContext> {}

/** A sub-route of {@link RepoContainer} specific to repository settings. */
export interface RepoSettingsContainerRoute extends RouteDescriptor<RepoSettingsContainerContext> {}

const RepoPageNotFound: React.FunctionComponent<React.PropsWithChildren<unknown>> = () => (
    <HeroPage icon={MapSearchIcon} title="404: Not Found" subtitle="The repository page was not found." />
)

const EmptyRepo: React.FunctionComponent<React.PropsWithChildren<unknown>> = () => (
    <HeroPage icon={RepoQuestionIcon} title="Empty repository" />
)

interface RepoContainerProps
    extends SettingsCascadeProps<Settings>,
        PlatformContextProps,
        TelemetryProps,
        ExtensionsControllerProps,
        ThemeProps,
        Pick<SearchContextProps, 'selectedSearchContextSpec' | 'searchContextsEnabled'>,
        BreadcrumbSetters,
        BreadcrumbsProps,
        SearchStreamingProps,
        Pick<StreamingSearchResultsListProps, 'fetchHighlightedFileLineRanges'>,
        CodeIntelligenceProps,
        BatchChangesProps,
        CodeInsightsProps,
        NotebookProps {
    repoContainerRoutes: readonly RepoContainerRoute[]
    repoSettingsContainerRoutes: readonly RepoSettingsContainerRoute[]
    repoRevisionContainerRoutes: readonly RepoRevisionContainerRoute[]
    repoHeaderActionButtons: readonly RepoHeaderActionButton[]
    repoSettingsAreaRoutes: readonly RepoSettingsAreaRoute[]
    repoSettingsSidebarGroups: readonly RepoSettingsSideBarGroup[]
    authenticatedUser: AuthenticatedUser | null
    globbing: boolean
    isMacPlatform: boolean
    isSourcegraphDotCom: boolean
}

export interface HoverThresholdProps {
    /**
     * Called when a hover with content is shown.
     */
    onHoverShown?: () => void
}

/**
 * Renders a horizontal bar and content for a repository page.
 */
export const RepoContainer: React.FunctionComponent<React.PropsWithChildren<RepoContainerProps>> = props => {
    const { extensionsController, globbing } = props

    const location = useLocation()
    const { repoName, revision, rawRevision, filePath, commitRange, position, range } = parseBrowserRepoURL(
        location.pathname + location.search + location.hash
    )

    const resolvedRevisionOrError = useObservable(
        useMemo(
            () =>
                of(undefined)
                    .pipe(
                        // Wrap in switchMap, so we don't break the observable chain when
                        // catchError returns a new observable, so repeatUntil will
                        // properly resubscribe to the outer observable and re-fetch.
                        switchMap(() =>
                            resolveRepoRevision({ repoName, revision }).pipe(
                                catchError(error => {
                                    const redirect = isRepoSeeOtherErrorLike(error)

                                    if (redirect) {
                                        redirectToExternalHost(redirect)
                                        return NEVER
                                    }

                                    if (isCloneInProgressErrorLike(error)) {
                                        return of<ErrorLike>(asError(error))
                                    }

                                    throw error
                                })
                            )
                        )
                    )
                    .pipe(
                        repeatUntil(value => !isCloneInProgressErrorLike(value), { delay: 1000 }),
                        catchError(error => of<ErrorLike>(asError(error)))
                    ),
            [repoName, revision]
        )
    )

    /**
     * A long time ago, we fetched `repo` in a separate GraphQL query.
     * This GraphQL query was merged into the `resolveRevision` query to
     * speed up the network requests waterfall. To minimize the blast radius
     * of changes required to make it work, continue working with the `repo`
     * data as if it was received from a separate query.
     */
    const repoOrError = isErrorLike(resolvedRevisionOrError) ? resolvedRevisionOrError : resolvedRevisionOrError?.repo

    // The external links to show in the repository header, if any.
    const [externalLinks, setExternalLinks] = useState<ExternalLinkFields[] | undefined>()

    // The lifecycle props for repo header contributions.
    const [repoHeaderContributionsLifecycleProps, setRepoHeaderContributionsLifecycleProps] =
        useState<RepoHeaderContributionsLifecycleProps>()

    const childBreadcrumbSetters = props.useBreadcrumb(
        useMemo(() => {
            if (isErrorLike(resolvedRevisionOrError) || isErrorLike(repoOrError)) {
                return
            }

            const button = (
                <Button
                    to={resolvedRevisionOrError?.rootTreeURL || repoOrError?.url || ''}
                    disabled={!resolvedRevisionOrError}
                    className="text-nowrap test-repo-header-repo-link"
                    variant="secondary"
                    outline={true}
                    size="sm"
                    as={Link}
                >
                    <Icon aria-hidden={true} svgPath={mdiSourceRepository} /> {displayRepoName(repoName)}
                </Button>
            )

            return {
                key: 'repository',
                element: button,
            }
        }, [resolvedRevisionOrError, repoOrError, repoName])
    )

    // Update the workspace roots service to reflect the current repo / resolved revision
    useEffect(() => {
        const workspaceRootUri =
            resolvedRevisionOrError &&
            !isErrorLike(resolvedRevisionOrError) &&
            makeRepoURI({
                repoName,
                revision: resolvedRevisionOrError.commitID,
            })

        if (workspaceRootUri && extensionsController !== null) {
            extensionsController.extHostAPI
                .then(extensionHostAPI =>
                    extensionHostAPI.addWorkspaceRoot({
                        uri: workspaceRootUri,
                        inputRevision: revision || '',
                    })
                )
                .catch(error => {
                    logger.error('Error adding workspace root', error)
                })
        }

        // Clear the Sourcegraph extensions model's roots when navigating away.
        return () => {
            if (workspaceRootUri && extensionsController !== null) {
                extensionsController.extHostAPI
                    .then(extensionHostAPI => extensionHostAPI.removeWorkspaceRoot(workspaceRootUri))
                    .catch(error => {
                        logger.error('Error removing workspace root', error)
                    })
            }
        }
    }, [extensionsController, repoName, resolvedRevisionOrError, revision])

    // Update the navbar query to reflect the current repo / revision
    const onNavbarQueryChange = useNavbarQueryState(state => state.setQueryState)
    useEffect(() => {
        let query = searchQueryForRepoRevision(repoName, globbing, revision)
        if (filePath) {
            query = `${query.trimEnd()} file:${escapeSpaces(globbing ? filePath : '^' + escapeRegExp(filePath))}`
        }
        onNavbarQueryChange({
            query,
        })
    }, [revision, filePath, repoName, onNavbarQueryChange, globbing])

    const { useActionItemsBar, useActionItemsToggle } = useWebActionItems()

    const repoMatchURL = '/' + encodeURIPathComponent(repoName)

    // render go to the code host action on all the repo container routes and on all compare spec routes
    const isGoToCodeHostActionVisible = useMemo(() => {
        if (!window.context.enableLegacyExtensions) {
            return true
        }
        const paths = [
            ...props.repoContainerRoutes.map(route => route.path),
            ...props.repoSettingsContainerRoutes.map(route => route.path),
            compareSpecPath,
            commitsPath,
        ]

        return paths.some(path => matchPath(location.pathname, { path: repoMatchURL + path }))
    }, [props.repoContainerRoutes, props.repoSettingsContainerRoutes, repoMatchURL, location.pathname])

    const isError = isErrorLike(repoOrError) || isErrorLike(resolvedRevisionOrError)

    // if revision for given repo does not resolve then we still proceed to render settings routes
    // while returning empty repository for all other routes
    const isEmptyRepo = isRevisionNotFoundErrorLike(repoOrError)

    // for repo errors beyond revision not found (aka empty repository)
    // we defer to RepoContainerError for every repo container request
    if (isError && !isEmptyRepo) {
        const viewerCanAdminister = !!props.authenticatedUser && props.authenticatedUser.siteAdmin

        return (
            <RepoContainerError
                repoName={repoName}
                viewerCanAdminister={viewerCanAdminister}
                repoFetchError={repoOrError as ErrorLike}
            />
        )
    }

    const repo = isError ? undefined : repoOrError
    const resolvedRevision = isError ? undefined : resolvedRevisionOrError
    const isCodeIntelRepositoryBadgeVisible = getIsCodeIntelRepositoryBadgeVisible({
        location,
        settingsCascade: props.settingsCascade,
        revision,
        repoName,
    })

    const repoRevisionContainerContext: RepoRevisionContainerContext = {
        ...props,
        ...repoHeaderContributionsLifecycleProps,
        ...childBreadcrumbSetters,
        repo,
        repoName,
        revision: revision || '',
        resolvedRevision,
        routePrefix: repoMatchURL,
        useActionItemsBar,
        location,
    }

    /**
     * `RepoContainerContextRoutes` depend on `repoOrError`. We render these routes only when
     * the `repoOrError` value is resolved. If repoOrError resolves to error due to empty repository
     * then we return Empty Repository
     */
    const getRepoContainerContextRoutes = (): (false | JSX.Element)[] | null => {
        if (repo) {
            const repoContainerContext: RepoContainerContext = {
                ...repoRevisionContainerContext,
                repo,
                resolvedRevisionOrError,
                onDidUpdateExternalLinks: setExternalLinks,
                repoName,
            }

            return [
                ...props.repoContainerRoutes.map(
                    ({ path, render, exact, condition = () => true }) =>
                        condition(repoContainerContext) && (
                            <Route
                                path={repoContainerContext.routePrefix + path}
                                key="hardcoded-key" // see https://github.com/ReactTraining/react-router/issues/4578#issuecomment-334489490
                                exact={exact}
                                render={routeComponentProps =>
                                    render({
                                        ...repoContainerContext,
                                        ...routeComponentProps,
                                    })
                                }
                            />
                        )
                ),
                <Route key="hardcoded-key" component={RepoPageNotFound} />,
            ]
        }

        if (repoOrError) {
            // We cannot render these routes for an empty repository
            return [<Route key="hardcoded-key" component={EmptyRepo} />]
        }

        return null
    }

    const getRepoSettingsContainerContextRoutes = (): (false | JSX.Element)[] | null => {
        if (repoOrError) {
            const repoSettingsContainerContext: RepoSettingsContainerContext = {
                ...repoRevisionContainerContext,
                onDidUpdateExternalLinks: setExternalLinks,
                repoName,
            }

            return [
                ...props.repoSettingsContainerRoutes.map(({ path, render, exact, condition = () => true }) => (
                    <Route
                        path={repoSettingsContainerContext.routePrefix + path}
                        key="hardcoded-key" // see https://github.com/ReactTraining/react-router/issues/4578#issuecomment-334489490
                        exact={exact}
                        render={routeComponentProps =>
                            render({
                                ...repoSettingsContainerContext,
                                ...routeComponentProps,
                            })
                        }
                    />
                )),
            ]
        }

        return null
    }

    const perforceCodeHostUrlToSwarmUrlMap =
        (props.settingsCascade.final &&
            !isErrorLike(props.settingsCascade.final) &&
            props.settingsCascade.final?.['perforce.codeHostToSwarmMap']) ||
        {}

    return (
        <div className={classNames('w-100 d-flex flex-column', styles.repoContainer)}>
            <RepoHeader
                actionButtons={props.repoHeaderActionButtons}
                useActionItemsToggle={useActionItemsToggle}
                breadcrumbs={props.breadcrumbs}
                repoName={repoName}
                revision={revision}
                onLifecyclePropsChange={setRepoHeaderContributionsLifecycleProps}
                settingsCascade={props.settingsCascade}
                authenticatedUser={props.authenticatedUser}
                platformContext={props.platformContext}
                extensionsController={extensionsController}
                telemetryService={props.telemetryService}
            />
            {isGoToCodeHostActionVisible && (
                <RepoHeaderContributionPortal
                    position="right"
                    priority={2}
                    id="go-to-code-host"
                    {...repoHeaderContributionsLifecycleProps}
                >
                    {({ actionType }) => (
                        <GoToCodeHostAction
                            repo={repo}
                            repoName={repoName}
                            // We need a revision to generate code host URLs, if revision isn't available, we use the default branch or HEAD.
                            revision={rawRevision || repo?.defaultBranch?.displayName || 'HEAD'}
                            filePath={filePath}
                            commitRange={commitRange}
                            range={range}
                            position={position}
                            perforceCodeHostUrlToSwarmUrlMap={perforceCodeHostUrlToSwarmUrlMap}
                            fetchFileExternalLinks={fetchFileExternalLinks}
                            actionType={actionType}
                            source="repoHeader"
                            key="go-to-code-host"
                            externalLinks={externalLinks}
                        />
                    )}
                </RepoHeaderContributionPortal>
            )}

            {isCodeIntelRepositoryBadgeVisible && (
                <RepoHeaderContributionPortal
                    position="right"
                    priority={110}
                    id="code-intelligence-status"
                    {...repoHeaderContributionsLifecycleProps}
                >
                    {({ actionType }) =>
                        props.codeIntelligenceBadgeMenu && actionType === 'nav' ? (
                            <props.codeIntelligenceBadgeMenu
                                key="code-intelligence-status"
                                repoName={repoName}
                                revision={rawRevision || 'HEAD'}
                                filePath={filePath || ''}
                                settingsCascade={props.settingsCascade}
                            />
                        ) : (
                            <></>
                        )
                    }
                </RepoHeaderContributionPortal>
            )}

            <ErrorBoundary location={location}>
                <Suspense fallback={null}>
                    <Switch>
                        {[
                            '',
                            ...(rawRevision ? [`@${rawRevision}`] : []), // must exactly match how the revision was encoded in the URL
                            '/-/blob',
                            '/-/tree',
                            '/-/commits',
                            '/-/docs',
                            '/-/branch',
                            '/-/contributors',
                            '/-/compare',
                            '/-/tag',
                            '/-/home',
                        ].map(
                            routePath =>
                                !isEmptyRepo && ( // must be non-empty repo to resolve a revision
                                    <Route
                                        path={`${repoMatchURL}${routePath}`}
                                        key="hardcoded-key" // see https://github.com/ReactTraining/react-router/issues/4578#issuecomment-334489490
                                        exact={routePath === ''}
                                        render={routeComponentProps => (
                                            <RepoRevisionContainer
                                                {...routeComponentProps}
                                                {...repoRevisionContainerContext}
                                                {...childBreadcrumbSetters}
                                                routes={props.repoRevisionContainerRoutes}
                                                // must exactly match how the revision was encoded in the URL
                                                routePrefix={`${repoMatchURL}${rawRevision ? `@${rawRevision}` : ''}`}
                                            />
                                        )}
                                    />
                                )
                        )}
                        {getRepoSettingsContainerContextRoutes()}
                        {getRepoContainerContextRoutes()}
                    </Switch>
                </Suspense>
            </ErrorBoundary>
        </div>
    )
}

function getIsCodeIntelRepositoryBadgeVisible(options: {
    settingsCascade: RepoContainerProps['settingsCascade']
    location: H.Location
    repoName: string
    revision: string | undefined
}): boolean {
    const { settingsCascade, repoName, revision, location } = options

    const isCodeIntelRepositoryBadgeEnabled =
        !isErrorLike(settingsCascade.final) &&
        settingsCascade.final?.experimentalFeatures?.codeIntelRepositoryBadge?.enabled === true

    // Remove leading repository name and possible leading revision, then compare the remaining routes to
    // see if we should display the code graph badge for this route. We want this to be visible on
    // the repo root page, as well as directory and code views, but not administrative/non-code views.
    //
    // + 1 for the leading `/` in the pathname
    const matchRevisionAndRest = location.pathname.slice(repoName.length + 1)
    const matchOnlyRest =
        revision && matchRevisionAndRest.startsWith(`@${revision || ''}`)
            ? matchRevisionAndRest.slice(revision.length + 1)
            : matchRevisionAndRest
    const isCodeIntelRepositoryBadgeVisibleOnRoute =
        matchOnlyRest === '' || matchOnlyRest.startsWith('/-/tree') || matchOnlyRest.startsWith('/-/blob')

    return isCodeIntelRepositoryBadgeEnabled && isCodeIntelRepositoryBadgeVisibleOnRoute
}
