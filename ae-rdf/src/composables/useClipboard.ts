/**
 * useClipboard - Clipboard operations with toast notifications
 *
 * Provides a simple interface for copying text to clipboard
 * with user feedback via toast notifications.
 *
 * @see /spec/ae-skos/sko06-Utilities.md
 */
import { useToast } from 'primevue/usetoast'

export function useClipboard() {
  const toast = useToast()

  /**
   * Copy text to clipboard with toast notification
   * @param text - The text to copy
   * @param label - Human-readable label for the copied content (e.g., "URI", "RDF")
   */
  async function copyToClipboard(text: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      toast.add({
        severity: 'success',
        summary: 'Copied',
        detail: `${label} copied to clipboard`,
        life: 2000
      })
    } catch (e) {
      toast.add({
        severity: 'error',
        summary: 'Failed',
        detail: 'Could not copy to clipboard',
        life: 3000
      })
    }
  }

  return {
    copyToClipboard
  }
}
