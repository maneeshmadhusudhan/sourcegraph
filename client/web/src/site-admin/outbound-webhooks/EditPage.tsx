import { FC, useCallback, useEffect, useState } from 'react'

import { mdiCog } from '@mdi/js'
import { noop } from 'lodash'
import { RouteComponentProps } from 'react-router'

import { useMutation, useQuery } from '@sourcegraph/http-client'
import { TelemetryProps } from '@sourcegraph/shared/src/telemetry/telemetryService'
import { Container, ErrorAlert, Form, Input, LoadingSpinner, PageHeader } from '@sourcegraph/wildcard'

import { PageTitle } from '../../components/PageTitle'
import {
    OutboundWebhookByIDResult,
    OutboundWebhookByIDVariables,
    OutboundWebhookFields,
    UpdateOutboundWebhookResult,
    UpdateOutboundWebhookVariables,
} from '../../graphql-operations'

import { OUTBOUND_WEBHOOK_BY_ID, UPDATE_OUTBOUND_WEBHOOK } from './backend'
import { EventTypes } from './create-edit/EventTypes'
import { SubmitButton } from './create-edit/SubmitButton'
import { DeleteButton } from './delete/DeleteButton'
import { Logs } from './logs/Logs'

export interface EditPageProps extends TelemetryProps, RouteComponentProps<{ id: string }> {}

export const EditPage: FC<EditPageProps> = ({ history, match, telemetryService }) => {
    const { id } = match.params

    useEffect(() => {
        telemetryService.logPageView('OutboundWebhooksEditPage')
    }, [telemetryService])

    const { data, loading, error, refetch } = useQuery<OutboundWebhookByIDResult, OutboundWebhookByIDVariables>(
        OUTBOUND_WEBHOOK_BY_ID,
        { variables: { id } }
    )
    const webhookURL = data?.node?.__typename === 'OutboundWebhook' ? data.node.url : undefined

    const onDeleted = useCallback(() => {
        history.push('/site-admin/outbound-webhooks')
    }, [history])

    if (error) {
        return (
            <div>
                <Header id={id} url={webhookURL} onDeleted={onDeleted} />

                <Container>
                    <ErrorAlert error={error} />
                </Container>
            </div>
        )
    }

    if (loading) {
        return (
            <div>
                <Header id={id} url={webhookURL} onDeleted={onDeleted} />

                <Container>
                    <LoadingSpinner />
                </Container>
            </div>
        )
    }

    return (
        <div>
            <Header id={id} url={webhookURL} onDeleted={onDeleted} />

            <Container>
                {data?.node?.__typename === 'OutboundWebhook' ? (
                    <EditForm
                        onSave={() => {
                            refetch().catch(noop)
                        }}
                        webhook={data.node}
                    />
                ) : (
                    <LoadingSpinner />
                )}
            </Container>

            <Container className="mt-3" id="logs">
                <Logs id={id} />
            </Container>
        </div>
    )
}

interface EditFormProps {
    onSave: () => void
    webhook: OutboundWebhookFields
}

const EditForm: FC<EditFormProps> = ({ onSave, webhook }) => {
    const [url, setURL] = useState(webhook.url)
    const [eventTypes, setEventTypes] = useState<Set<string>>(
        new Set(webhook.eventTypes.map(eventType => eventType?.eventType ?? '').filter(eventType => eventType !== ''))
    )

    const [updateWebhook, { error, loading }] = useMutation<
        UpdateOutboundWebhookResult,
        UpdateOutboundWebhookVariables
    >(UPDATE_OUTBOUND_WEBHOOK, {
        variables: {
            id: webhook.id,
            input: {
                eventTypes: [...eventTypes].map(eventType => ({
                    eventType,
                })),
                url,
            },
        },
        onCompleted: () => {
            onSave()
        },
    })

    return (
        <>
            {error && <ErrorAlert error={error} />}
            <Form>
                <Input label="URL" required={true} value={url} onChange={event => setURL(event.target.value)} />
                <EventTypes className="border-top pt-2" values={eventTypes} onChange={setEventTypes} />
                <SubmitButton
                    onClick={() => {
                        updateWebhook().catch(noop)
                    }}
                    state={loading ? 'loading' : eventTypes.size === 0 ? 'disabled' : undefined}
                >
                    Save
                </SubmitButton>
            </Form>
        </>
    )
}

interface HeaderProps {
    id: string
    onDeleted: () => void
    url?: string
}

const Header: FC<HeaderProps> = ({ id, onDeleted, url }) => (
    <>
        <PageTitle title="Edit outgoing webhook" />
        <PageHeader
            path={[
                { icon: mdiCog },
                { to: '/site-admin/outbound-webhooks', text: 'Outgoing webhooks' },
                {
                    to: `/site-admin/outbound-webhooks/${id}`,
                    text: url || 'Edit',
                },
            ]}
            headingElement="h2"
            description="Edit an outgoing webhook"
            className="mb-3"
            actions={<DeleteButton id={id} onDeleted={onDeleted} />}
        />
    </>
)
