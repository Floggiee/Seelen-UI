import { _invoke, webviewInfo } from "./_tauri";
import type { FocusedApp } from "@seelen-ui/lib/types";
import { emitTo, listen } from "@tauri-apps/api/event";

// trigger garbage collection
setInterval(() => {
  window.gc?.();
}, 10000);

const MEMORY_CHECK_INTERVAL = 30_000; // check every 30s, cheap operation
const HEAP_THRESHOLD_MB = 150; // hard ceiling — reload regardless of trend
const GROWTH_WINDOW_MB = 40; // "kept growing by this much since last GC" = leak signal
const MIN_TIME_BETWEEN_RELOADS = 5 * 60_000; // never reload more than once per 5 min

let lastReloadAt = Date.now();
let heapAfterLastGc: number | null = null;

if (!window.__SLU_WIDGET.noMemoryLeakWorkaround) {
  setInterval(async () => {
    // performance.memory is Chromium-only (fine here, this is always WebView2)
    // and nonstandard/coarse-grained, but good enough for threshold checks.
    const mem = (performance as any).memory;
    if (!mem) return; // fall back to doing nothing rather than reloading blind

    const usedMb = mem.usedJSHeapSize / 1024 / 1024;
    const timeSinceReload = Date.now() - lastReloadAt;

    // trigger 1: hard ceiling, regardless of trend
    const overThreshold = usedMb > HEAP_THRESHOLD_MB;

    // trigger 2: heap isn't shrinking after GC passes — real leak, not just churn
    const notRecoveringAfterGc = heapAfterLastGc !== null && usedMb > heapAfterLastGc + GROWTH_WINDOW_MB;

    if ((overThreshold || notRecoveringAfterGc) && timeSinceReload > MIN_TIME_BETWEEN_RELOADS) {
      const app = await _invoke<FocusedApp>("get_focused_app");
      if (app.isFullscreened || app.exe?.endsWith("seelen-ui.exe")) {
        return; // still respect the "don't interrupt fullscreen" rule
      }
      console.trace(`Reloading widget: heap=${usedMb.toFixed(1)}MB`);
      location.search = `r=${Date.now()}`;
    }
  }, MEMORY_CHECK_INTERVAL);

  // record heap right after each manual GC pass, to use as the "recovery baseline"
  setInterval(() => {
    try {
      window.gc?.();
      const mem = (performance as any).memory;
      if (mem) heapAfterLastGc = mem.usedJSHeapSize / 1024 / 1024;
    } catch (_e) {
      // Silently ignore GC errors to prevent crashes
    }
  }, MIN_TIME_BETWEEN_RELOADS);
}

// important in case of unexpected crash like Out of Memory
listen<string>(
  "internal::liveness-ping",
  () => {
    emitTo(webviewInfo.rawLabel, "internal::liveness-pong");
  },
  {
    target: {
      kind: "WebviewWindow",
      label: webviewInfo.rawLabel,
    },
  },
);
