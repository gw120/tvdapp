import Document, { Head, Main, NextScript } from 'next/document'
import flush from 'styled-jsx/server'

export default class MyDocument extends Document {
    static getInitialProps({ renderPage }) {
        const { html, head, errorHtml, chunks } = renderPage()
        const styles = flush()
        return { html, head, errorHtml, chunks, styles }
    }

    render() {
        return (
            <html>
                <Head>
                    <style>{`body { margin: 0 } html { font-family: Roboto, sans-serif; -webkit-font-smoothing: antialiased; }`}</style>
                    <meta charSet='utf-8' />
                    <meta name='viewport' content='initial-scale=1.0, width=device-width' />
                    <link href="//unpkg.com/tachyons@4.8.1/css/tachyons.min.css" rel="stylesheet" />
                    <link rel='stylesheet' type='text/css' href='//ricostacruz.com/nprogress/nprogress.css' />
                </Head>
                <body>
                    <Main />
                    <NextScript />
                </body>
            </html>
        )
    }
}