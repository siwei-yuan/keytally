// 灯珠选区交互:点选 + 拖拽框选,命中 .led-hit[data-idx]。
// 与渲染解耦:通过回调询问是否可用、通知变更。

export interface LedSelectionOpts {
  container: HTMLElement;
  enabled: () => boolean;
  selection: Set<number>;
  onChange: () => void;
}

export function initLedSelection(o: LedSelectionOpts) {
  let dragStart: { x: number; y: number } | null = null;
  let dragBox: HTMLDivElement | null = null;

  o.container.addEventListener("pointerdown", (e) => {
    if (!o.enabled()) return;
    const hit = (e.target as Element).closest?.(".led-hit") as SVGGElement | null;
    if (hit) {
      const idx = Number(hit.dataset.idx);
      if (o.selection.has(idx)) o.selection.delete(idx);
      else o.selection.add(idx);
      o.onChange();
      return;
    }
    dragStart = { x: e.clientX, y: e.clientY };
    dragBox = document.createElement("div");
    dragBox.className = "drag-box";
    document.body.appendChild(dragBox);
  });

  window.addEventListener("pointermove", (e) => {
    if (!dragStart || !dragBox) return;
    Object.assign(dragBox.style, {
      left: `${Math.min(dragStart.x, e.clientX)}px`,
      top: `${Math.min(dragStart.y, e.clientY)}px`,
      width: `${Math.abs(e.clientX - dragStart.x)}px`,
      height: `${Math.abs(e.clientY - dragStart.y)}px`,
    });
  });

  window.addEventListener("pointerup", (e) => {
    if (!dragStart) return;
    const x1 = Math.min(dragStart.x, e.clientX), y1 = Math.min(dragStart.y, e.clientY);
    const x2 = Math.max(dragStart.x, e.clientX), y2 = Math.max(dragStart.y, e.clientY);
    dragBox?.remove();
    dragBox = null;
    dragStart = null;
    if (x2 - x1 < 6 && y2 - y1 < 6) return; // 视为点击空白
    if (!o.enabled()) return;
    o.container.querySelectorAll<SVGGElement>(".led-hit").forEach((g) => {
      const r = g.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2) o.selection.add(Number(g.dataset.idx));
    });
    o.onChange();
  });
}
