<script setup lang="ts">
/**
 * DetailsHeader - Shared header for detail views
 *
 * Renders the header section with icon, title, URI, and action buttons.
 * Used by both SchemeDetails and ConceptDetails.
 *
 * @see /spec/ae-skos/sko04-ConceptDetails.md
 */
import { ref } from 'vue'
import { isValidURI } from '../../services'
import { useClipboard } from '../../composables'
import Menu from 'primevue/menu'

interface MenuItem {
  label: string
  icon?: string
  command?: () => void
}

interface Props {
  icon: string                    // 'folder' | 'label' | 'circle'
  iconClass: string               // 'icon-folder' | 'icon-label' | 'icon-leaf'
  wrapperClass?: string           // Additional class for wrapper (e.g., 'wrapper-leaf')
  title: string
  uri: string
  langTag?: string
  showLangTag?: boolean
  deprecated?: boolean
  deprecatedTooltip?: string
  exportMenuItems?: MenuItem[]
}

const props = withDefaults(defineProps<Props>(), {
  showLangTag: false,
  deprecated: false,
  deprecatedTooltip: 'This resource is deprecated',
})

const emit = defineEmits<{
  showRawRdf: []
}>()

const { copyToClipboard } = useClipboard()
const exportMenu = ref()

function handleExport(event: Event) {
  exportMenu.value?.toggle(event)
}
</script>

<template>
  <div class="details-header">
    <div class="header-icon-wrapper" :class="wrapperClass">
      <span class="material-symbols-outlined header-icon" :class="iconClass">{{ icon }}</span>
    </div>
    <div class="header-content">
      <h2 class="resource-label">
        {{ title }}
        <span v-if="showLangTag && langTag" class="header-lang-tag">{{ langTag }}</span>
        <span
          v-if="deprecated"
          class="deprecated-badge"
          v-tooltip="deprecatedTooltip"
        >deprecated</span>
      </h2>
      <div class="resource-uri">
        <span class="uri-text mono">{{ uri }}</span>
        <button
          class="copy-btn"
          title="Copy URI"
          @click="copyToClipboard(uri, 'URI')"
        >
          <span class="material-symbols-outlined icon-sm">content_copy</span>
        </button>
      </div>
    </div>
    <div class="header-actions">
      <button class="action-btn" title="View RDF" @click="emit('showRawRdf')">
        <span class="material-symbols-outlined">code</span>
      </button>
      <button
        v-if="exportMenuItems?.length"
        class="action-btn"
        title="Export"
        @click="handleExport"
      >
        <span class="material-symbols-outlined">download</span>
      </button>
      <a
        v-if="isValidURI(uri)"
        :href="uri"
        target="_blank"
        class="action-btn"
        title="Open in new tab"
      >
        <span class="material-symbols-outlined">open_in_new</span>
      </a>
      <Menu
        v-if="exportMenuItems?.length"
        ref="exportMenu"
        :model="exportMenuItems"
        :popup="true"
      />
    </div>
  </div>
</template>

<style scoped>
.details-header {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 2rem;
}

.header-icon-wrapper {
  padding: 0.75rem;
  background: color-mix(in srgb, var(--ae-icon-folder) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--ae-icon-folder) 25%, transparent);
  border-radius: 0.75rem;
}

.header-icon-wrapper.wrapper-leaf {
  background: color-mix(in srgb, var(--ae-icon-leaf) 15%, transparent);
  border-color: color-mix(in srgb, var(--ae-icon-leaf) 25%, transparent);
}

.header-icon {
  font-size: 2.5rem;
}

.header-content {
  flex: 1;
  min-width: 0;
}

.resource-label {
  margin: 0 0 0.375rem 0;
  font-size: 1.375rem;
  font-weight: 600;
  color: var(--ae-text-primary);
  word-break: break-word;
}

.header-lang-tag {
  font-size: 0.625rem;
  font-weight: normal;
  background: var(--ae-bg-hover);
  color: var(--ae-text-secondary);
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  margin-left: 0.5rem;
  vertical-align: middle;
}

.resource-uri {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.125rem 0.375rem;
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-color);
  border-radius: 3px;
}

.uri-text {
  font-size: 0.6875rem;
  color: var(--ae-text-secondary);
  word-break: break-all;
}

.copy-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  background: none;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  color: var(--ae-text-secondary);
  transition: color 0.15s;
}

.copy-btn:hover {
  color: var(--ae-text-primary);
}

.header-actions {
  display: flex;
  gap: 0.25rem;
  flex-shrink: 0;
}
</style>
