/**
 * Composable for managing screen wake lock during file transfer
 * Keeps the screen on while user is actively transferring files
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
 */

// Declare locally for environments where WakeLockSentinel is absent from DOM lib
interface WakeLockSentinelLike extends EventTarget {
  readonly released: boolean
  readonly type: "screen"
  release(): Promise<void>
}

type NavigatorWithWakeLock = Navigator & {
  wakeLock: { request(type: "screen"): Promise<WakeLockSentinelLike> }
}

export function useWakeLock() {
  // Internal state — properly scoped within composable
  const wakeLock = ref<WakeLockSentinelLike | null>(null)
  const error = ref<string | null>(null)

  // Plain variables: not reactive — only used for internal control flow
  let wasActive = false
  let intentionalRelease = false
  let acquiring = false
  let releaseWhileAcquiring = false

  // computed() is correct here: navigator is undefined on SSR, defined on client.
  // The value never changes after hydration, but computed() provides SSR safety.
  const isSupported = computed(() => {
    return typeof navigator !== "undefined" && "wakeLock" in navigator
  })

  /**
   * Acquire wake lock to prevent screen from sleeping.
   * Returns true if the lock was successfully acquired.
   */
  const acquire = async (): Promise<boolean> => {
    if (!isSupported.value) {
      console.warn("[WakeLock] Not supported in this browser")
      return false
    }

    // Already holding a wake lock
    if (wakeLock.value) {
      return true
    }

    // Prevent concurrent acquire calls — a previous request is still in-flight
    if (acquiring) {
      return false
    }

    acquiring = true
    releaseWhileAcquiring = false

    try {
      const newLock = await (
        navigator as NavigatorWithWakeLock
      ).wakeLock.request("screen")

      // release() was called while we were awaiting the OS grant — honour it
      if (releaseWhileAcquiring) {
        releaseWhileAcquiring = false
        await newLock.release()
        return false
      }

      wakeLock.value = newLock
      wakeLock.value.addEventListener(
        "release",
        () => {
          // Null the ref first so acquire() guard works correctly on retry
          wakeLock.value = null
          if (!intentionalRelease) {
            // Flag re-acquire intent for next visibility change.
            // Covers both page-hidden OS releases and system policy releases
            // (e.g. low-battery) while the page is still visible.
            wasActive = true
            // If the page is already visible, retry immediately
            if (
              typeof document !== "undefined" &&
              document.visibilityState === "visible"
            ) {
              acquire().then((success) => {
                if (success) wasActive = false
              })
            }
          }
        },
        { once: true },
      )

      error.value = null
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Unknown error"
      console.warn("[WakeLock] Failed to acquire:", err)
      return false
    } finally {
      acquiring = false
    }
  }

  /**
   * Release wake lock to allow screen to sleep normally.
   */
  const release = async (): Promise<void> => {
    // Always clear intent first — even if the lock was already auto-released
    wasActive = false

    if (acquiring) {
      // An acquire() call is in-flight; signal it to release once granted
      releaseWhileAcquiring = true
      return
    }

    if (!wakeLock.value) {
      return
    }

    intentionalRelease = true
    try {
      await wakeLock.value.release()
      // wakeLock.value is nullified by the 'release' event listener above
    } catch (err) {
      console.warn("[WakeLock] Failed to release:", err)
    } finally {
      intentionalRelease = false
    }
  }

  const handleVisibilityChange = async () => {
    if (document.visibilityState === "visible" && wasActive) {
      // Re-acquire wake lock when page becomes visible again.
      // If acquire fails, wasActive remains true so the next visibility
      // change retries — no infinite loop since we wait for an OS event.
      const success = await acquire()
      if (success) {
        wasActive = false
      }
    }
  }

  onMounted(() => {
    // onMounted only fires on the client, never on SSR.
    // The isSupported guard avoids attaching a dead listener on unsupported browsers.
    if (!isSupported.value) return
    document.addEventListener("visibilitychange", handleVisibilityChange)
  })

  onUnmounted(async () => {
    // onUnmounted only fires on the client.
    document.removeEventListener("visibilitychange", handleVisibilityChange)
    await release()
  })

  return {
    isSupported,
    error: readonly(error),
    acquire,
    release,
  }
}
