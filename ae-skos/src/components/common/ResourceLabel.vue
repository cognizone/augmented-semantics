<script setup lang="ts">
/**
 * ResourceLabel - Consistent resource label display component
 *
 * Displays a resource with consistent formatting:
 * - notation - label [lang-tag-if-different]
 * - uri (copyable link)
 *
 * Used across all components for unified label display.
 *
 * @see /spec/ae-skos/sko04-ConceptDetails.md
 */
import { computed } from 'vue'
import { useLabelResolver } from '../../composables'
import { isValidURI } from '../../services'
import { useToast } from 'primevue/usetoast'
import Button from 'primevue/button'

const props = withDefaults(defineProps<{
  uri: string
  label?: string
  notation?: string
  lang?: string
  showUri?: boolean
  compact?: boolean
}>(), {
  showUri: true,
  compact: false,
})

const toast = useToast()
const { shouldShowLangTag } = useLabelResolver()

// Computed display values
const displayLabel = computed(() => {
  if (props.notation && props.label) {
    return `${props.notation} - ${props.label}`
  }
  return props.notation || props.label || extractUriFragment(props.uri)
})

const showLangTag = computed(() => {
  return props.lang && shouldShowLangTag(props.lang)
})

const isLinkable = computed(() => {
  return isValidURI(props.uri)
})

function extractUriFragment(uri: string): string {
  if (!uri) return ''
  // Try hash fragment first, then last path segment
  const hashIndex = uri.lastIndexOf('#')
  if (hashIndex !== -1) {
    return uri.substring(hashIndex + 1)
  }
  const slashIndex = uri.lastIndexOf('/')
  if (slashIndex !== -1) {
    return uri.substring(slashIndex + 1)
  }
  return uri
}

async function copyUri() {
  try {
    await navigator.clipboard.writeText(props.uri)
    toast.add({
      severity: 'success',
      summary: 'Copied',
      detail: 'URI copied to clipboard',
      life: 2000,
    })
  } catch {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Could not copy to clipboard',
      life: 3000,
    })
  }
}
</script>

<template>
  <div :class="['resource-label', { compact }]">
    <span class="label-text">
      {{ displayLabel }}
      <span v-if="showLangTag" class="lang-tag">{{ lang }}</span>
    </span>
    <div v-if="showUri && !compact" class="uri-row">
      <a
        v-if="isLinkable"
        :href="uri"
        target="_blank"
        rel="noopener noreferrer"
        class="uri-link"
      >
        {{ uri }}
        <i class="pi pi-external-link"></i>
      </a>
      <span v-else class="uri-text">{{ uri }}</span>
      <Button
        icon="pi pi-copy"
        severity="secondary"
        text
        rounded
        size="small"
        class="copy-btn"
        v-tooltip.left="'Copy URI'"
        @click.stop="copyUri"
      />
    </div>
  </div>
</template>

<style scoped>
.resource-label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.resource-label.compact {
  flex-direction: row;
  align-items: center;
  gap: 0.5rem;
}

.label-text {
  font-weight: 500;
}

.lang-tag {
  font-size: 0.625rem;
  font-weight: normal;
  background: var(--p-surface-200);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  margin-left: 0.25rem;
  vertical-align: middle;
}

.uri-row {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.uri-link,
.uri-text {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  word-break: break-all;
}

.uri-link {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  text-decoration: none;
}

.uri-link:hover {
  text-decoration: underline;
  color: var(--p-primary-color);
}

.uri-link .pi {
  font-size: 0.625rem;
}

.copy-btn {
  flex-shrink: 0;
}

/* Compact mode adjustments */
.compact .uri-row {
  display: none;
}
</style>
