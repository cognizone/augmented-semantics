/**
 * useDelayedLoading - Delayed loading indicator composable
 *
 * Shows loading indicator only after a delay to prevent flicker
 * for fast operations. Per com03-ErrorHandling spec.
 *
 * @param loading - Reactive loading state to watch
 * @param delay - Milliseconds to wait before showing spinner (default: 300ms)
 * @returns Reactive boolean that becomes true only after delay
 *
 * @see /spec/common/com03-ErrorHandling.md
 */
import { ref, watch, onUnmounted, type Ref } from 'vue'

export function useDelayedLoading(loading: Ref<boolean>, delay = 300) {
  const showLoading = ref(false)
  let timeoutId: number | null = null

  const cleanup = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  watch(loading, (isLoading) => {
    if (isLoading) {
      // Start timer to show loading after delay
      timeoutId = window.setTimeout(() => {
        showLoading.value = true
      }, delay)
    } else {
      // Cancel timer and hide loading immediately
      cleanup()
      showLoading.value = false
    }
  }, { immediate: true })

  // Cleanup on unmount
  onUnmounted(cleanup)

  return showLoading
}
