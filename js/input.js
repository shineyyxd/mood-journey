// ————————————————————————————————————————————————
// input.js · 全局快捷键
// ————————————————————————————————————————————————
export function bindKeys(handlers) {
  window.addEventListener('keydown', (e) => {
    // 输入框聚焦时只放行 Enter/Escape
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' && e.key !== 'Enter' && e.key !== 'Escape') return;

    const k = e.key.toLowerCase();
    if (e.key === ' ') { e.preventDefault(); handlers.space?.(); }
    else if (e.key === 'Enter') handlers.enter?.();
    else if (k === 'd') handlers.demo?.();
    else if (k === 't') handlers.skin?.();
    else if (k === 'q') handlers.quality?.();
    else if (k === 'p') handlers.params?.();
    else if (k === 'm') handlers.mute?.();
    else if (k === 's') handlers.snapshot?.();
    else if (k === 'u') handlers.share?.();
    else if (k === 'r') handlers.reset?.();
    else if (k === 'h' || e.key === '?') handlers.help?.();
    else if (e.key === 'Escape') handlers.escape?.();
    else if (/^[0-9]$/.test(e.key)) handlers.debug?.(parseInt(e.key, 10));
  });
}
