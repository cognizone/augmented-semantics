/**
 * useEndpointTest - Endpoint connection testing composable
 *
 * Handles SPARQL endpoint connection testing with state management
 * and result formatting.
 *
 * @see /spec/common/com01-EndpointManager.md
 */
import { ref, type Ref } from 'vue'
import { testConnection as testConnectionService } from '../services/sparql'
import type { SPARQLEndpoint } from '../types'

export interface TestResult {
  success: boolean
  message: string
  time?: number
}

export function useEndpointTest() {
  const testing = ref(false)
  const testResult: Ref<TestResult | null> = ref(null)

  /**
   * Test connection to a SPARQL endpoint
   */
  async function testConnection(endpoint: SPARQLEndpoint): Promise<TestResult> {
    testing.value = true
    testResult.value = null

    const result = await testConnectionService(endpoint)
    testing.value = false

    if (result.success) {
      const successResult = {
        success: true,
        message: `Connected successfully (${result.responseTime}ms)`,
        time: result.responseTime,
      }
      testResult.value = successResult

      // Auto-dismiss success message after 3 seconds
      setTimeout(() => {
        if (testResult.value?.success) {
          testResult.value = null
        }
      }, 3000)

      return successResult
    } else {
      const errorResult = {
        success: false,
        message: result.error?.message || 'Connection failed',
      }
      testResult.value = errorResult
      return errorResult
    }
  }

  /**
   * Clear test result
   */
  function clearResult() {
    testResult.value = null
  }

  return {
    testing,
    testResult,
    testConnection,
    clearResult,
  }
}
