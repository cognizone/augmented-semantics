<script setup lang="ts">
/**
 * RawRdfDialog - View raw RDF in multiple formats
 *
 * Reusable dialog component for viewing raw RDF data of any resource
 * (concept, scheme, etc.) in various serialization formats.
 *
 * @see /spec/ae-skos/sko06-Utilities.md
 */
import { ref, watch } from 'vue'
import { useEndpointStore } from '../../stores'
import { fetchRawRdf, logger } from '../../services'
import { useClipboard } from '../../composables'
import type { RdfFormat } from '../../services'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import Select from 'primevue/select'
import Textarea from 'primevue/textarea'
import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'

interface Props {
  visible: boolean
  resourceUri: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const endpointStore = useEndpointStore()
const { copyToClipboard } = useClipboard()

// State
const rawRdfContent = ref('')
const rawRdfFormat = ref<RdfFormat>('turtle')
const rawRdfLoading = ref(false)
const rawRdfError = ref<string | null>(null)

const rdfFormatOptions = [
  { label: 'Turtle', value: 'turtle' },
  { label: 'JSON-LD', value: 'jsonld' },
  { label: 'N-Triples', value: 'ntriples' },
  { label: 'RDF/XML', value: 'rdfxml' },
]

// Load raw RDF
async function loadRawRdf() {
  if (!props.resourceUri || !endpointStore.current) return

  rawRdfLoading.value = true
  rawRdfError.value = null
  rawRdfContent.value = ''

  try {
    const rdf = await fetchRawRdf(
      endpointStore.current,
      props.resourceUri,
      rawRdfFormat.value
    )
    rawRdfContent.value = rdf
  } catch (e: unknown) {
    const errMsg = e && typeof e === 'object' && 'message' in e
      ? (e as { message: string }).message
      : 'Failed to fetch RDF'
    rawRdfError.value = errMsg
    logger.error('RawRdfDialog', 'Failed to fetch raw RDF', { error: e })
  } finally {
    rawRdfLoading.value = false
  }
}

// Watch for dialog opening
watch(() => props.visible, (isVisible) => {
  if (isVisible && props.resourceUri) {
    loadRawRdf()
  }
})

// Handle dialog close
function handleClose() {
  emit('update:visible', false)
}
</script>

<template>
  <Dialog
    :visible="visible"
    header="Raw RDF"
    :style="{ width: '900px', maxHeight: '90vh' }"
    :modal="true"
    @update:visible="handleClose"
  >
    <div class="raw-rdf-dialog">
      <div class="format-selector">
        <label>Format:</label>
        <Select
          v-model="rawRdfFormat"
          :options="rdfFormatOptions"
          optionLabel="label"
          optionValue="value"
          @change="loadRawRdf"
        />
        <Button
          icon="pi pi-copy"
          label="Copy"
          severity="secondary"
          size="small"
          :disabled="!rawRdfContent"
          @click="copyToClipboard(rawRdfContent, 'RDF')"
        />
      </div>

      <div v-if="rawRdfLoading" class="rdf-loading">
        <ProgressSpinner style="width: 30px; height: 30px" />
        <span>Loading RDF...</span>
      </div>

      <Message v-if="rawRdfError" severity="error" :closable="false">
        {{ rawRdfError }}
      </Message>

      <Textarea
        v-if="rawRdfContent && !rawRdfLoading"
        v-model="rawRdfContent"
        :readonly="true"
        class="rdf-content"
        :autoResize="false"
        rows="28"
      />
    </div>
  </Dialog>
</template>

<style scoped>
.raw-rdf-dialog {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.format-selector {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.format-selector label {
  font-weight: 500;
}

.rdf-loading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: center;
  padding: 2rem;
  color: var(--p-text-muted-color);
}

.rdf-content {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 0.7rem;
  width: 100%;
  background: var(--p-surface-50);
}
</style>
