/**
 * UI Store Tests
 *
 * Tests for application UI state management.
 * @see /spec/common/com02-StateManagement.md
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUIStore } from '../ui'

describe('ui store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('settings dialog', () => {
    it('starts with settings dialog closed', () => {
      const store = useUIStore()
      expect(store.settingsDialogOpen).toBe(false)
      expect(store.settingsSection).toBe('display')
    })

    it('setSettingsDialogOpen opens dialog', () => {
      const store = useUIStore()
      store.setSettingsDialogOpen(true)
      expect(store.settingsDialogOpen).toBe(true)
    })

    it('setSettingsDialogOpen closes dialog', () => {
      const store = useUIStore()
      store.settingsDialogOpen = true
      store.setSettingsDialogOpen(false)
      expect(store.settingsDialogOpen).toBe(false)
    })

    it('setSettingsSection changes active section', () => {
      const store = useUIStore()
      store.setSettingsSection('search')
      expect(store.settingsSection).toBe('search')
      store.setSettingsSection('developer')
      expect(store.settingsSection).toBe('developer')
    })

    it('openSettingsDialog opens dialog with default section', () => {
      const store = useUIStore()
      store.openSettingsDialog()
      expect(store.settingsDialogOpen).toBe(true)
      expect(store.settingsSection).toBe('display')
    })

    it('openSettingsDialog opens dialog to specific section', () => {
      const store = useUIStore()
      store.openSettingsDialog('search')
      expect(store.settingsDialogOpen).toBe(true)
      expect(store.settingsSection).toBe('search')
    })

    it('openSettingsDialog preserves section if none provided', () => {
      const store = useUIStore()
      store.settingsSection = 'developer'
      store.openSettingsDialog()
      expect(store.settingsDialogOpen).toBe(true)
      expect(store.settingsSection).toBe('developer')
    })

    it('closeAllDialogs closes settings dialog', () => {
      const store = useUIStore()
      store.settingsDialogOpen = true
      store.closeAllDialogs()
      expect(store.settingsDialogOpen).toBe(false)
    })
  })
})
