import * as React from "react"

const MOBILE_BREAKPOINT = 768

const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(callback: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", callback)
  return () => mql.removeEventListener("change", callback)
}

function getSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT
}

// Server rendering: assume desktop (matches SSR output on hydration).
function getServerSnapshot() {
  return false
}

/**
 * Reactive mobile-width check via useSyncExternalStore — no setState-in-effect
 * (keeps the react-hooks/set-state-in-effect lint rule satisfied).
 */
export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
