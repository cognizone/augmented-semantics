/**
 * useElapsedTime Composable Tests
 *
 * Tests for elapsed time display in progress indicators
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { useElapsedTime } from '../useElapsedTime'

describe('useElapsedTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with elapsed at 0 and show as false', () => {
    const isActive = ref(false)
    const elapsed = useElapsedTime(isActive)

    expect(elapsed.elapsed.value).toBe(0)
    expect(elapsed.show.value).toBe(false)
  })

  it('does not count when inactive', () => {
    const isActive = ref(false)
    const elapsed = useElapsedTime(isActive)

    vi.advanceTimersByTime(5000)

    expect(elapsed.elapsed.value).toBe(0)
    expect(elapsed.show.value).toBe(false)
  })

  it('starts counting when active', () => {
    const isActive = ref(true)
    const elapsed = useElapsedTime(isActive)

    vi.advanceTimersByTime(1000)
    expect(elapsed.elapsed.value).toBe(1)

    vi.advanceTimersByTime(1000)
    expect(elapsed.elapsed.value).toBe(2)
  })

  it('does not show elapsed before delay', () => {
    const isActive = ref(true)
    const elapsed = useElapsedTime(isActive)

    vi.advanceTimersByTime(999)
    expect(elapsed.show.value).toBe(false)
  })

  it('shows elapsed after default 1 second delay', () => {
    const isActive = ref(true)
    const elapsed = useElapsedTime(isActive)

    vi.advanceTimersByTime(1000)
    expect(elapsed.show.value).toBe(true)
  })

  it('respects custom delay option', () => {
    const isActive = ref(true)
    const elapsed = useElapsedTime(isActive, { delayMs: 5000 })

    vi.advanceTimersByTime(4999)
    expect(elapsed.show.value).toBe(false)

    vi.advanceTimersByTime(1)
    expect(elapsed.show.value).toBe(true)
  })

  it('resets when becoming inactive', async () => {
    const isActive = ref(true)
    const elapsed = useElapsedTime(isActive)

    vi.advanceTimersByTime(3000)
    expect(elapsed.elapsed.value).toBe(3)
    expect(elapsed.show.value).toBe(true)

    isActive.value = false
    await nextTick()
    expect(elapsed.elapsed.value).toBe(0)
    expect(elapsed.show.value).toBe(false)
  })

  it('restarts when becoming active again', async () => {
    const isActive = ref(true)
    const elapsed = useElapsedTime(isActive)

    vi.advanceTimersByTime(3000)
    expect(elapsed.elapsed.value).toBe(3)

    isActive.value = false
    await nextTick()
    expect(elapsed.elapsed.value).toBe(0)
    expect(elapsed.show.value).toBe(false)

    isActive.value = true
    await nextTick()
    // After reactivating, should start fresh
    vi.advanceTimersByTime(2500)
    expect(elapsed.elapsed.value).toBe(2)
    expect(elapsed.show.value).toBe(true)
  })

  it('formatted returns null when not showing', () => {
    const isActive = ref(true)
    const elapsed = useElapsedTime(isActive)

    vi.advanceTimersByTime(500)
    expect(elapsed.formatted()).toBeNull()
  })

  it('formatted returns elapsed string when showing', () => {
    const isActive = ref(true)
    const elapsed = useElapsedTime(isActive)

    vi.advanceTimersByTime(3000)
    expect(elapsed.formatted()).toBe('3s')
  })
})
