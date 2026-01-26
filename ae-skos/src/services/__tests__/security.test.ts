/**
 * Security Service Tests
 *
 * Tests for SPARQL injection prevention, URI validation, HTML sanitization.
 * @see /spec/common/com06-Security.md
 * @see /spec/ae-skos/sko07-Testing.md
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  escapeSparqlString,
  escapeSparqlRegex,
  validateURI,
  isValidURI,
  sanitizeSearchInput,
  sanitizeHtml,
  checkEndpointSecurity,
  assessEndpointTrust,
  isValidEndpointUrl,
  storeCredentials,
  getCredentials,
  clearCredentials,
} from '../security'

describe('escapeSparqlString', () => {
  it('escapes backslashes', () => {
    expect(escapeSparqlString('path\\to\\file')).toBe('path\\\\to\\\\file')
  })

  it('escapes double quotes', () => {
    expect(escapeSparqlString('say "hello"')).toBe('say \\"hello\\"')
  })

  it('escapes single quotes', () => {
    expect(escapeSparqlString("it's")).toBe("it\\'s")
  })

  it('escapes newlines', () => {
    expect(escapeSparqlString('line1\nline2')).toBe('line1\\nline2')
  })

  it('escapes carriage returns', () => {
    expect(escapeSparqlString('line1\rline2')).toBe('line1\\rline2')
  })

  it('escapes tabs', () => {
    expect(escapeSparqlString('col1\tcol2')).toBe('col1\\tcol2')
  })

  it('handles empty string', () => {
    expect(escapeSparqlString('')).toBe('')
  })

  it('handles string with multiple special characters', () => {
    // Input: backslash, quote, newline
    const input = 'test\\"value\n'
    const output = escapeSparqlString(input)
    expect(output).toContain('\\\\') // escaped backslash
    expect(output).toContain('\\"') // escaped quote
    expect(output).toContain('\\n') // escaped newline
  })

  it('handles plain text without escaping', () => {
    expect(escapeSparqlString('simple text')).toBe('simple text')
  })
})

describe('escapeSparqlRegex', () => {
  it('escapes dots', () => {
    expect(escapeSparqlRegex('file.txt')).toBe('file\\.txt')
  })

  it('escapes asterisks', () => {
    expect(escapeSparqlRegex('test*')).toBe('test\\*')
  })

  it('escapes question marks', () => {
    expect(escapeSparqlRegex('is this?')).toBe('is this\\?')
  })

  it('escapes brackets', () => {
    expect(escapeSparqlRegex('[a-z]')).toBe('\\[a-z\\]')
  })

  it('escapes parentheses', () => {
    expect(escapeSparqlRegex('(group)')).toBe('\\(group\\)')
  })

  it('escapes curly braces', () => {
    expect(escapeSparqlRegex('{1,3}')).toBe('\\{1,3\\}')
  })

  it('escapes pipe', () => {
    expect(escapeSparqlRegex('a|b')).toBe('a\\|b')
  })

  it('escapes caret', () => {
    expect(escapeSparqlRegex('^start')).toBe('\\^start')
  })

  it('escapes dollar sign', () => {
    expect(escapeSparqlRegex('end$')).toBe('end\\$')
  })

  it('escapes plus', () => {
    expect(escapeSparqlRegex('a+')).toBe('a\\+')
  })

  it('escapes backslash', () => {
    expect(escapeSparqlRegex('a\\b')).toBe('a\\\\b')
  })
})

describe('validateURI', () => {
  it('accepts http:// URIs', () => {
    expect(validateURI('http://example.org/resource')).toBe('http://example.org/resource')
  })

  it('accepts https:// URIs', () => {
    expect(validateURI('https://example.org/resource')).toBe('https://example.org/resource')
  })

  it('accepts urn: URIs', () => {
    expect(validateURI('urn:isbn:0451450523')).toBe('urn:isbn:0451450523')
  })

  it('rejects javascript: URIs', () => {
    expect(validateURI('javascript:alert(1)')).toBeNull()
  })

  it('rejects data: URIs', () => {
    expect(validateURI('data:text/html,<script>alert(1)</script>')).toBeNull()
  })

  it('rejects vbscript: URIs', () => {
    expect(validateURI('vbscript:msgbox(1)')).toBeNull()
  })

  it('rejects file: URIs', () => {
    expect(validateURI('file:///etc/passwd')).toBeNull()
  })

  it('rejects empty strings', () => {
    expect(validateURI('')).toBeNull()
  })

  it('rejects null/undefined', () => {
    expect(validateURI(null as unknown as string)).toBeNull()
    expect(validateURI(undefined as unknown as string)).toBeNull()
  })

  it('trims whitespace', () => {
    expect(validateURI('  https://example.org/  ')).toBe('https://example.org/')
  })

  it('rejects ftp: URIs', () => {
    expect(validateURI('ftp://example.org/file')).toBeNull()
  })

  it('rejects mailto: URIs', () => {
    expect(validateURI('mailto:test@example.org')).toBeNull()
  })

  it('handles case insensitive dangerous protocols', () => {
    expect(validateURI('JAVASCRIPT:alert(1)')).toBeNull()
    expect(validateURI('JavaScript:alert(1)')).toBeNull()
    expect(validateURI('DATA:text/html,test')).toBeNull()
  })
})

describe('isValidURI', () => {
  it('returns true for valid URIs', () => {
    expect(isValidURI('https://example.org')).toBe(true)
  })

  it('returns false for invalid URIs', () => {
    expect(isValidURI('javascript:alert(1)')).toBe(false)
  })
})

describe('sanitizeSearchInput', () => {
  it('trims whitespace', () => {
    expect(sanitizeSearchInput('  search term  ')).toBe('search term')
  })

  it('limits length to default 500', () => {
    const longInput = 'a'.repeat(600)
    expect(sanitizeSearchInput(longInput).length).toBe(500)
  })

  it('limits length to custom max', () => {
    expect(sanitizeSearchInput('hello world', 5)).toBe('hello')
  })

  it('removes < characters', () => {
    expect(sanitizeSearchInput('<script>alert(1)</script>')).toBe('scriptalert(1)/script')
  })

  it('removes > characters', () => {
    expect(sanitizeSearchInput('1 > 0')).toBe('1  0')
  })

  it('handles empty string', () => {
    expect(sanitizeSearchInput('')).toBe('')
  })

  it('handles null/undefined', () => {
    expect(sanitizeSearchInput(null as unknown as string)).toBe('')
    expect(sanitizeSearchInput(undefined as unknown as string)).toBe('')
  })
})

describe('sanitizeHtml', () => {
  it('removes script tags', () => {
    const result = sanitizeHtml('<script>alert(1)</script>')
    expect(result).not.toContain('script')
    expect(result).not.toContain('alert')
  })

  it('preserves allowed HTML elements (b, i, em, strong)', () => {
    const html = '<b>bold</b> <i>italic</i> <em>emphasis</em> <strong>strong</strong>'
    expect(sanitizeHtml(html)).toBe(html)
  })

  it('preserves links with href', () => {
    const html = '<a href="https://example.org">link</a>'
    expect(sanitizeHtml(html)).toContain('href="https://example.org"')
    expect(sanitizeHtml(html)).toContain('link')
  })

  it('preserves br tags', () => {
    expect(sanitizeHtml('line1<br>line2')).toContain('<br>')
  })

  it('preserves paragraph tags', () => {
    expect(sanitizeHtml('<p>paragraph</p>')).toBe('<p>paragraph</p>')
  })

  it('preserves list elements', () => {
    const html = '<ul><li>item1</li><li>item2</li></ul>'
    expect(sanitizeHtml(html)).toBe(html)
  })

  it('removes onclick attributes', () => {
    const html = '<a href="#" onclick="alert(1)">click</a>'
    expect(sanitizeHtml(html)).not.toContain('onclick')
  })

  it('removes style attributes', () => {
    const html = '<p style="color: red">text</p>'
    expect(sanitizeHtml(html)).not.toContain('style=')
    expect(sanitizeHtml(html)).toBe('<p>text</p>')
  })

  it('removes div tags (not in allowed list)', () => {
    expect(sanitizeHtml('<div>content</div>')).toBe('content')
  })

  it('removes img tags', () => {
    expect(sanitizeHtml('<img src="x.jpg">')).toBe('')
  })
})

describe('checkEndpointSecurity', () => {
  it('identifies HTTPS endpoints', () => {
    const result = checkEndpointSecurity('https://example.org/sparql')
    expect(result.isHttps).toBe(true)
    expect(result.warning).toBeUndefined()
  })

  it('identifies localhost HTTP as safe', () => {
    const result = checkEndpointSecurity('http://localhost:8080/sparql')
    expect(result.isHttps).toBe(false)
    expect(result.isLocalhost).toBe(true)
    expect(result.warning).toContain('Local endpoint')
  })

  it('identifies 127.0.0.1 as localhost', () => {
    const result = checkEndpointSecurity('http://127.0.0.1:8080/sparql')
    expect(result.isLocalhost).toBe(true)
  })

  it('warns about HTTP for remote endpoints', () => {
    const result = checkEndpointSecurity('http://example.org/sparql')
    expect(result.isHttps).toBe(false)
    expect(result.isLocalhost).toBe(false)
    expect(result.warning).toContain('HTTP')
    expect(result.warning).toContain('intercepted')
  })

  it('handles invalid URLs', () => {
    const result = checkEndpointSecurity('not-a-url')
    expect(result.warning).toContain('Invalid')
  })
})

describe('assessEndpointTrust', () => {
  it('marks dbpedia.org as trusted', () => {
    const result = assessEndpointTrust('https://dbpedia.org/sparql')
    expect(result.level).toBe('trusted')
    expect(result.reasons).toContain('Known trusted vocabulary provider')
  })

  it('marks wikidata.org subdomains as trusted', () => {
    const result = assessEndpointTrust('https://query.wikidata.org/sparql')
    expect(result.level).toBe('trusted')
  })

  it('marks data.europa.eu as trusted', () => {
    const result = assessEndpointTrust('https://data.europa.eu/sparql')
    expect(result.level).toBe('trusted')
  })

  it('marks unknown HTTPS endpoints as unknown', () => {
    const result = assessEndpointTrust('https://unknown-endpoint.org/sparql')
    expect(result.level).toBe('unknown')
  })

  it('warns about HTTP for unknown endpoints', () => {
    const result = assessEndpointTrust('http://unknown-endpoint.org/sparql')
    expect(result.level).toBe('warning')
    expect(result.reasons).toContain('Uses HTTP (insecure)')
  })

  it('does not warn about HTTP for localhost', () => {
    const result = assessEndpointTrust('http://localhost:8080/sparql')
    expect(result.reasons).not.toContain('Uses HTTP (insecure)')
  })

  it('handles invalid URLs', () => {
    const result = assessEndpointTrust('not-a-url')
    expect(result.level).toBe('warning')
    expect(result.reasons).toContain('Invalid URL')
  })
})

describe('isValidEndpointUrl', () => {
  it('accepts https URLs', () => {
    expect(isValidEndpointUrl('https://example.org/sparql')).toBe(true)
  })

  it('accepts http URLs', () => {
    expect(isValidEndpointUrl('http://example.org/sparql')).toBe(true)
  })

  it('rejects ftp URLs', () => {
    expect(isValidEndpointUrl('ftp://example.org/files')).toBe(false)
  })

  it('rejects empty strings', () => {
    expect(isValidEndpointUrl('')).toBe(false)
  })

  it('rejects null/undefined', () => {
    expect(isValidEndpointUrl(null as unknown as string)).toBe(false)
    expect(isValidEndpointUrl(undefined as unknown as string)).toBe(false)
  })

  it('rejects invalid URLs', () => {
    expect(isValidEndpointUrl('not a url')).toBe(false)
  })

  it('trims whitespace', () => {
    expect(isValidEndpointUrl('  https://example.org/sparql  ')).toBe(true)
  })
})

describe('dynamic trusted domains', () => {
  it('trusts endpoints from endpoints.json', () => {
    // AgroPortal is a suggested endpoint from endpoints.json
    const result = assessEndpointTrust('https://sparql.agroportal.lirmm.fr/sparql')
    expect(result.level).toBe('trusted')
    expect(result.reasons).toContain('Known trusted vocabulary provider')
  })

  it('does not trust unrelated domains', () => {
    const result = assessEndpointTrust('https://random-unknown-domain.xyz/sparql')
    expect(result.level).toBe('unknown')
    expect(result.reasons).not.toContain('Known trusted vocabulary provider')
  })
})

describe('credential storage', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  describe('storeCredentials', () => {
    it('stores credentials in sessionStorage', () => {
      storeCredentials('endpoint-1', { username: 'user', password: 'pass' })
      expect(sessionStorage.setItem).toHaveBeenCalled()
    })

    it('encodes credentials as base64', () => {
      storeCredentials('endpoint-1', { username: 'user', password: 'pass' })
      const call = vi.mocked(sessionStorage.setItem).mock.calls[0]
      expect(call).toBeDefined()
      const stored = JSON.parse(call![1])
      expect(stored['endpoint-1'].encoded).toBeDefined()
    })
  })

  describe('getCredentials', () => {
    it('retrieves stored credentials', () => {
      // Store directly in mock
      const creds = { username: 'user', password: 'pass' }
      const stored = {
        'endpoint-1': {
          encoded: btoa(JSON.stringify(creds)),
          storedAt: new Date().toISOString(),
        },
      }
      vi.mocked(sessionStorage.getItem).mockReturnValue(JSON.stringify(stored))

      const result = getCredentials('endpoint-1')
      expect(result).toEqual(creds)
    })

    it('returns null for non-existent endpoint', () => {
      vi.mocked(sessionStorage.getItem).mockReturnValue(null)
      expect(getCredentials('non-existent')).toBeNull()
    })
  })

  describe('clearCredentials', () => {
    it('removes credentials for endpoint', () => {
      const stored = {
        'endpoint-1': { encoded: 'abc', storedAt: '2024-01-01' },
        'endpoint-2': { encoded: 'def', storedAt: '2024-01-01' },
      }
      vi.mocked(sessionStorage.getItem).mockReturnValue(JSON.stringify(stored))

      clearCredentials('endpoint-1')

      const call = vi.mocked(sessionStorage.setItem).mock.calls[0]
      expect(call).toBeDefined()
      const updated = JSON.parse(call![1])
      expect(updated['endpoint-1']).toBeUndefined()
      expect(updated['endpoint-2']).toBeDefined()
    })
  })
})
