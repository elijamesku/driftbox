import { Html, Head, Main, NextScript } from 'next/document'
import React from 'react'

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* Essential SEO Meta Tags */}
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="format-detection" content="telephone=no" />
        <meta name="referrer" content="origin-when-cross-origin" />
        
        {/* Basic favicon - just one is fine 
        <link rel="icon" href="/favicon.ico" />
        */}
        {/* Essential robots meta */}
        <meta name="robots" content="index, follow" />
        
        {/* Language */}
        <meta name="language" content="English" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}