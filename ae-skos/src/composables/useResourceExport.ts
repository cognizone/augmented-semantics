/**
 * useResourceExport - Resource export functionality
 *
 * Provides export capabilities for SKOS concepts and schemes
 * in multiple formats (JSON, Turtle, CSV).
 *
 * @see /spec/ae-skos/sko06-Utilities.md
 */
import { useToast } from 'primevue/usetoast'
import { useEndpointStore } from '../stores'
import { fetchRawRdf } from '../services'
import type { ConceptDetails } from '../types'

export function useResourceExport() {
  const toast = useToast()
  const endpointStore = useEndpointStore()

  /**
   * Download a file to the user's computer
   * @param content - The file content
   * @param filename - The filename to save as
   * @param mimeType - The MIME type of the file
   */
  function downloadFile(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  /**
   * Export a concept as JSON
   * @param details - The concept details to export
   */
  function exportAsJson(details: ConceptDetails): void {
    const jsonData = {
      uri: details.uri,
      prefLabels: details.prefLabels,
      altLabels: details.altLabels,
      hiddenLabels: details.hiddenLabels,
      notations: details.notations,
      definitions: details.definitions,
      scopeNotes: details.scopeNotes,
      broader: details.broader,
      narrower: details.narrower,
      related: details.related,
      inScheme: details.inScheme,
      exactMatch: details.exactMatch,
      closeMatch: details.closeMatch,
    }

    const content = JSON.stringify(jsonData, null, 2)
    const filename = `concept-${details.uri.split('/').pop() || 'export'}.json`
    downloadFile(content, filename, 'application/json')

    toast.add({
      severity: 'success',
      summary: 'Exported',
      detail: 'Concept exported as JSON',
      life: 2000
    })
  }

  /**
   * Export a concept as Turtle (fetches from endpoint)
   * @param uri - The concept URI to export
   */
  async function exportAsTurtle(uri: string): Promise<void> {
    const endpoint = endpointStore.current
    if (!endpoint) return

    try {
      const turtle = await fetchRawRdf(endpoint, uri, 'turtle')
      const filename = `concept-${uri.split('/').pop() || 'export'}.ttl`
      downloadFile(turtle, filename, 'text/turtle')

      toast.add({
        severity: 'success',
        summary: 'Exported',
        detail: 'Concept exported as Turtle',
        life: 2000
      })
    } catch (e) {
      toast.add({
        severity: 'error',
        summary: 'Export failed',
        detail: 'Could not export as Turtle',
        life: 3000
      })
    }
  }

  /**
   * Export a concept as CSV
   * @param details - The concept details to export
   */
  function exportAsCsv(details: ConceptDetails): void {
    const rows: string[][] = [['Property', 'Value', 'Language']]

    // Add labels
    details.prefLabels.forEach(l => rows.push(['prefLabel', l.value, l.lang || '']))
    details.altLabels.forEach(l => rows.push(['altLabel', l.value, l.lang || '']))
    details.hiddenLabels.forEach(l => rows.push(['hiddenLabel', l.value, l.lang || '']))

    // Add notations
    details.notations.forEach(n => rows.push(['notation', n.value, n.datatype || '']))

    // Add documentation
    details.definitions.forEach(d => rows.push(['definition', d.value, d.lang || '']))
    details.scopeNotes.forEach(d => rows.push(['scopeNote', d.value, d.lang || '']))

    // Add relations
    details.broader.forEach(r => rows.push(['broader', r.uri, '']))
    details.narrower.forEach(r => rows.push(['narrower', r.uri, '']))
    details.related.forEach(r => rows.push(['related', r.uri, '']))

    // Add mappings
    details.exactMatch.forEach(u => rows.push(['exactMatch', u, '']))
    details.closeMatch.forEach(u => rows.push(['closeMatch', u, '']))

    // Convert to CSV
    const csv = rows.map(row =>
      row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')
    ).join('\n')

    const filename = `concept-${details.uri.split('/').pop() || 'export'}.csv`
    downloadFile(csv, filename, 'text/csv')

    toast.add({
      severity: 'success',
      summary: 'Exported',
      detail: 'Concept exported as CSV',
      life: 2000
    })
  }

  return {
    downloadFile,
    exportAsJson,
    exportAsTurtle,
    exportAsCsv
  }
}
