import type { EndpointAnalysis } from '../types'

function stripTrailingSlash(uri: string): string {
  return uri.replace(/\/+$/, '')
}

export function getSchemeUriVariants(
  schemeUri: string,
  analysis?: EndpointAnalysis,
  enableFix?: boolean
): string[] {
  if (!schemeUri) return []
  if (!enableFix || !analysis?.schemeUriSlashMismatch) return [schemeUri]

  const trimmed = stripTrailingSlash(schemeUri)
  const alt = schemeUri.endsWith('/') ? trimmed : `${trimmed}/`

  if (alt === schemeUri) return [schemeUri]
  return [schemeUri, alt]
}

export function buildSchemeValuesClause(
  schemeUri: string,
  analysis: EndpointAnalysis | undefined,
  enableFix: boolean,
  variable = 'scheme'
): { schemeTerm: string; valuesClause: string } {
  const variants = getSchemeUriVariants(schemeUri, analysis, enableFix)
  if (variants.length <= 1) {
    return {
      schemeTerm: `<${schemeUri}>`,
      valuesClause: '',
    }
  }

  const values = variants.map(uri => `<${uri}>`).join(' ')
  return {
    schemeTerm: `?${variable}`,
    valuesClause: `VALUES ?${variable} { ${values} }`,
  }
}
