require('isomorphic-fetch')
const join = require('lodash/join')

async function getImageFrom({ title }) {
    const tvmazeResponse = await fetch(`http://api.tvmaze.com/singlesearch/shows?q=${title}`)
    const json = await tvmazeResponse.json()
    return {
        img: json.image,
        title
    }
}

module.exports = {
    get
}