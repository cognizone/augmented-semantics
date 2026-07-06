import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Augmented Semantics',
  description: 'AI-powered toolkit for Semantic Web technologies',

  base: '/augmented-semantics/',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/augmented-semantics/logo.svg' }]
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Home', link: '/' },
      { text: 'AE SKOS', link: '/ae-skos/' },
      { text: 'AE RDF', link: '/ae-rdf/' },
      { text: 'Downloads', link: '/downloads' },
      {
        text: 'GitHub',
        link: 'https://github.com/cognizone/augmented-semantics',
        target: '_blank'
      }
    ],

    sidebar: {
      '/ae-skos/': [
        {
          text: 'User Guide',
          items: [
            { text: 'Overview', link: '/ae-skos/' },
            { text: '1. Managing Endpoints', link: '/ae-skos/01-endpoints' },
            { text: '2. Browsing', link: '/ae-skos/02-browsing' },
            { text: '3. Viewing Details', link: '/ae-skos/03-details' },
            { text: '4. Search & History', link: '/ae-skos/04-search' },
            { text: '5. Settings', link: '/ae-skos/05-settings' },
            { text: '6. Troubleshooting', link: '/ae-skos/06-troubleshooting' }
          ]
        },
        {
          text: 'Administration',
          items: [
            { text: 'Deployment Guide', link: '/ae-skos/deployment' },
            { text: 'CI/CD', link: '/ae-skos/ci-cd' }
          ]
        }
      ],
      '/ae-rdf/': [
        {
          text: 'User Guide',
          items: [
            { text: 'Overview', link: '/ae-rdf/' },
            { text: '1. Managing Endpoints', link: '/ae-rdf/01-endpoints' },
            { text: '2. Browsing', link: '/ae-rdf/02-browsing' },
            { text: '3. Graphs', link: '/ae-rdf/03-graphs' },
            { text: '4. Troubleshooting', link: '/ae-rdf/04-troubleshooting' }
          ]
        }
      ],
      '/ae-owl/': [
        {
          text: 'AE OWL',
          items: [
            { text: 'Overview', link: '/ae-owl/' }
          ]
        }
      ],
      '/ae-shacl/': [
        {
          text: 'AE SHACL',
          items: [
            { text: 'Overview', link: '/ae-shacl/' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/cognizone/augmented-semantics' }
    ],

    search: {
      provider: 'local'
    },

    footer: {
      message: 'Part of the <a href="https://github.com/cognizone/augmented-semantics">Augmented Semantics</a> toolkit',
      copyright: 'Built by <a href="https://cogni.zone">Cognizone</a>'
    },

    editLink: {
      pattern: 'https://github.com/cognizone/augmented-semantics/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    }
  }
})
