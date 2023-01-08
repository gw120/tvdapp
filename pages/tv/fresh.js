import { Component } from 'react'
import { initStore } from '../../mobx/store'
import Page from '../../components/page'


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

   
    render() {
        return (
            <Page type='fresh' store={this.store} />        
        )
    }
}