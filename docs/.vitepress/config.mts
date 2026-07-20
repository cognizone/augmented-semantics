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
            { text: 'Managing Endpoints', link: '/ae-rdf/endpoints' },
            { text: 'Browsing', link: '/ae-rdf/browsing' },
            { text: 'Faceted Browsing', link: '/ae-rdf/facets' },
            { text: 'SPARQL Panel', link: '/ae-rdf/sparql' },
            { text: 'Rich Values', link: '/ae-rdf/rich-values' },
            { text: 'Graphs', link: '/ae-rdf/graphs' },
            { text: 'Shareable URLs', link: '/ae-rdf/sharing' },
            { text: 'Troubleshooting', link: '/ae-rdf/troubleshooting' }
          ]
        },
        {
          text: 'Administration',
          items: [
            { text: 'Configuration Guide', link: '/ae-rdf/configuration' },
            { text: 'Deployment & Releases', link: '/ae-rdf/deployment' }
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
