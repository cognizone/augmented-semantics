/**
 * useElapsedTime - Elapsed time display for progress indicators
 *
 * Shows elapsed time after a delay (default 1 second).
 * Use this for any loading/progress state that may take a while.
 *
 * @example
 * const loading = ref(true)
 * const elapsed = useElapsedTime(loading)
 * // After 1 second: elapsed.value = "1s"
 * // Template: {{ stepName }}{{ elapsed ? ` (${elapsed})` : '' }}
 *
 * @see /spec/common/com03-ErrorHandling.md
 */
import { ref, watch, onUnmounted, type Ref } from 'vue'

export function useElapsedTime(
  isActive: Ref<boolean>,
  options: { delayMs?: number } = {}
) {
  const { delayMs = 1000 } = options

  const elapsedSeconds = ref(0)
  const showElapsed = ref(false)
  let timer: ReturnType<typeof setInterval> | null = null
  let delayTimer: ReturnType<typeof setTimeout> | null = null

  function startTimer() {
    elapsedSeconds.value = 0
    showElapsed.value = false

    // Start counting immediately
    timer = setInterval(() => {
      elapsedSeconds.value++
    }, 1000)

    // Show elapsed after delay
    delayTimer = setTimeout(() => {
      showElapsed.value = true
    }, delayMs)
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    if (delayTimer) {
      clearTimeout(delayTimer)
      delayTimer = null
    }
    elapsedSeconds.value = 0
    showElapsed.value = false
  }

  // Watch the active state
  watch(
    isActive,
    (active) => {
      if (active) {
        startTimer()
      } else {
        stopTimer()
      }
    },
    { immediate: true }
  )

  // Cleanup on unmount
  onUnmounted(() => {
    stopTimer()
  })

  // Return formatted elapsed time (or null if not showing yet)
  return {
    elapsed: elapsedSeconds,
    show: showElapsed,
    formatted: () => showElapsed.value ? `${elapsedSeconds.value}s` : null,
  }
}
