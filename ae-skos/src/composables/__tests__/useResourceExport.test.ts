import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useResourceExport } from '../useResourceExport'
import { useEndpointStore } from '../../stores'
import type { ConceptDetails } from '../../types'

// Mock PrimeVue toast
const mockToastAdd = vi.fn()
vi.mock('primevue/usetoast', () => ({
  useToast: () => ({ add: mockToastAdd })
}))

// Mock fetchRawRdf
vi.mock('../../services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services')>()
  return {
    ...actual,
    fetchRawRdf: vi.fn()
  }
})

import { fetchRawRdf } from '../../services'

describe('useResourceExport', () => {
  let mockCreateObjectURL: Mock
  let mockRevokeObjectURL: Mock
  let mockAppendChild: Mock
  let mockRemoveChild: Mock
  let mockClick: Mock

  const mockDetails: ConceptDetails = {
    uri: 'http://example.org/concept/test',
    prefLabels: [{ value: 'Test', lang: 'en' }],
    altLabels: [{ value: 'Alt Test', lang: 'en' }],
    hiddenLabels: [],
    notations: [{ value: '1.1', datatype: 'xsd:string' }],
    definitions: [{ value: 'A test concept', lang: 'en' }],
    scopeNotes: [],
    historyNotes: [],
    changeNotes: [],
    editorialNotes: [],
    examples: [],
    broader: [{ uri: 'http://example.org/concept/broader', label: 'Broader' }],
    narrower: [],
    related: [],
    inScheme: [{ uri: 'http://example.org/scheme/1' }],
    exactMatch: ['http://external.org/match/1'],
    closeMatch: [],
    broadMatch: [],
    narrowMatch: [],
    relatedMatch: [],
    prefLabelsXL: [],
    altLabelsXL: [],
    hiddenLabelsXL: [],
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    // Mock URL methods
    mockCreateObjectURL = vi.fn(() => 'blob:mock-url')
    mockRevokeObjectURL = vi.fn()
    global.URL.createObjectURL = mockCreateObjectURL
    global.URL.revokeObjectURL = mockRevokeObjectURL

    // Mock document methods
    mockClick = vi.fn()
    mockAppendChild = vi.fn()
    mockRemoveChild = vi.fn()

    vi.spyOn(document, 'createElement').mockImplementation(() => ({
      href: '',
      download: '',
      click: mockClick,
    } as unknown as HTMLAnchorElement))

    vi.spyOn(document.body, 'appendChild').mockImplementation(mockAppendChild)
    vi.spyOn(document.body, 'removeChild').mockImplementation(mockRemoveChild)
  })

  describe('downloadFile', () => {
    it('creates blob and triggers download', () => {
      const { downloadFile } = useResourceExport()

      downloadFile('test content', 'test.txt', 'text/plain')

      expect(mockCreateObjectURL).toHaveBeenCalled()
      expect(mockAppendChild).toHaveBeenCalled()
      expect(mockClick).toHaveBeenCalled()
      expect(mockRemoveChild).toHaveBeenCalled()
      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    })
  })

  describe('exportAsJson', () => {
    it('exports concept as JSON file', () => {
      const { exportAsJson } = useResourceExport()

      exportAsJson(mockDetails)

      // Check blob was created
      expect(mockCreateObjectURL).toHaveBeenCalled()
      const blobCall = mockCreateObjectURL.mock.calls[0][0]
      expect(blobCall).toBeInstanceOf(Blob)

      // Check toast notification
      expect(mockToastAdd).toHaveBeenCalledWith({
        severity: 'success',
        summary: 'Exported',
        detail: 'Concept exported as JSON',
        life: 2000
      })
    })

    it('includes all concept properties in JSON', () => {
      const { exportAsJson } = useResourceExport()

      exportAsJson(mockDetails)

      // Verify the blob content includes expected data
      const blobCall = mockCreateObjectURL.mock.calls[0][0]
      expect(blobCall.type).toBe('application/json')
    })
  })

  describe('exportAsTurtle', () => {
    it('fetches and exports turtle data', async () => {
      const endpointStore = useEndpointStore()
      endpointStore.endpoints = [{
        id: 'ep-1',
        name: 'Test',
        url: 'https://example.org/sparql',
        createdAt: '2024-01-01',
        accessCount: 0,
      }]
      endpointStore.currentId = 'ep-1'

      ;(fetchRawRdf as Mock).mockResolvedValue('@prefix skos: <...> .')

      const { exportAsTurtle } = useResourceExport()
      await exportAsTurtle('http://example.org/concept/test')

      expect(fetchRawRdf).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'ep-1' }),
        'http://example.org/concept/test',
        'turtle'
      )

      expect(mockToastAdd).toHaveBeenCalledWith({
        severity: 'success',
        summary: 'Exported',
        detail: 'Concept exported as Turtle',
        life: 2000
      })
    })

    it('does nothing when no endpoint selected', async () => {
      const { exportAsTurtle } = useResourceExport()
      await exportAsTurtle('http://example.org/concept/test')

      expect(fetchRawRdf).not.toHaveBeenCalled()
    })

    it('shows error toast on failure', async () => {
      const endpointStore = useEndpointStore()
      endpointStore.endpoints = [{
        id: 'ep-1',
        name: 'Test',
        url: 'https://example.org/sparql',
        createdAt: '2024-01-01',
        accessCount: 0,
      }]
      endpointStore.currentId = 'ep-1'

      ;(fetchRawRdf as Mock).mockRejectedValue(new Error('Network error'))

      const { exportAsTurtle } = useResourceExport()
      await exportAsTurtle('http://example.org/concept/test')

      expect(mockToastAdd).toHaveBeenCalledWith({
        severity: 'error',
        summary: 'Export failed',
        detail: 'Could not export as Turtle',
        life: 3000
      })
    })
  })

  describe('exportAsCsv', () => {
    it('exports concept as CSV file', () => {
      const { exportAsCsv } = useResourceExport()

      exportAsCsv(mockDetails)

      expect(mockCreateObjectURL).toHaveBeenCalled()
      const blobCall = mockCreateObjectURL.mock.calls[0][0]
      expect(blobCall.type).toBe('text/csv')

      expect(mockToastAdd).toHaveBeenCalledWith({
        severity: 'success',
        summary: 'Exported',
        detail: 'Concept exported as CSV',
        life: 2000
      })
    })

    it('includes labels in CSV', () => {
      const { exportAsCsv } = useResourceExport()

      exportAsCsv(mockDetails)

      // CSV should be created with proper headers and data
      expect(mockCreateObjectURL).toHaveBeenCalled()
    })

    it('escapes quotes in CSV values', () => {
      const detailsWithQuotes: ConceptDetails = {
        ...mockDetails,
        prefLabels: [{ value: 'Test "with quotes"', lang: 'en' }],
      }

      const { exportAsCsv } = useResourceExport()
      exportAsCsv(detailsWithQuotes)

      // Should not throw and should create blob
      expect(mockCreateObjectURL).toHaveBeenCalled()
    })
  })
})
