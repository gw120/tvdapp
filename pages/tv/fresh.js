import React, { Component } from 'react'
import { Provider } from 'mobx-react'
import { initStore } from '../../mobx/store'
import { setWeb3Instance, getBookmarks } from '../../services/blockChainService'
import Shows from '../../components/shows'
import Nav from '../../components/navigation'

export default class Fresh extends Component {
    static async getInitialProps() {
        const res = await fetch('http://localhost:3020/api/shows/fresh')
        const shows = await res.json()
        const showsInRow = 4
        return {
            shows,
            showsInRow
        }
    }

    componentDidMount() {
        setWeb3Instance()
            .then(() => getBookmarks())
            .then(shows => {
                console.log('componentDidMount')
                this.store.setBookmarkShows(shows)
            })
    }

    render() {
        return (
            <Shows {...this.props.store} />
        )
    }
}