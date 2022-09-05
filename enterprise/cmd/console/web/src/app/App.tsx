import './App.css'

import { useObservable } from '@sourcegraph/wildcard'
import React, { useMemo } from 'react'
import { Link, Redirect, Route, Switch } from 'react-router-dom'

import { Instances } from '../instances/Instances'
import { SignupPage } from '../trialStartFlow/steps/1-signup/SignupPage'
import { newAPIClient } from '../model/apiClient'
import { NewInstancePage } from '../trialStartFlow/steps/2-instance/NewInstancePage'

export const App: React.FunctionComponent = () => {
    const apiClient = useMemo(() => newAPIClient(), [])
    const data = useObservable(useMemo(() => apiClient.getData(), [apiClient]))

    return (
        <>
            {data === undefined ? null : data.user === null ? (
                <Switch>
                    <Route path="/signup">
                        <SignupPage />
                    </Route>
                    <Route path="*">
                        <Redirect to="/signup" />
                    </Route>
                </Switch>
            ) : (
                <Switch>
                    <Route path="/new-instance">
                        <NewInstancePage />
                    </Route>
                    <Route path="/instances">
                        <Instances instances={data.instances} className="content" />
                    </Route>
                </Switch>
            )}
        </>
    )
}
