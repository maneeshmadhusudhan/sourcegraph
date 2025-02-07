import { DecoratorFn, Meta, Story } from '@storybook/react'
import * as H from 'history'
import { WildcardMockLink } from 'wildcard-mock-link'

import { NOOP_TELEMETRY_SERVICE } from '@sourcegraph/shared/src/telemetry/telemetryService'
import { MockedTestProvider } from '@sourcegraph/shared/src/testing/apollo'

import { WebStory } from '../../components/WebStory'

import { EditPage } from './EditPage'
import { logConnectionLink, buildOutboundWebhookMock, eventTypesMock } from './mocks'

const decorator: DecoratorFn = story => <div className="p-3 container">{story()}</div>

const config: Meta = {
    title: 'web/site-admin/outbound-webhooks/EditPage',
    decorators: [decorator],
}

export default config

export const Page: Story = () => (
    <WebStory>
        {() => (
            <MockedTestProvider
                link={new WildcardMockLink([logConnectionLink, buildOutboundWebhookMock('abcdef'), eventTypesMock])}
            >
                <EditPage
                    match={{ params: { id: 'abcdef' } } as any}
                    history={H.createMemoryHistory()}
                    location={{} as any}
                    telemetryService={NOOP_TELEMETRY_SERVICE}
                />
            </MockedTestProvider>
        )}
    </WebStory>
)

Page.storyName = 'Page'
