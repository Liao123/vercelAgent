"use client";

type TripleLayoutResizeHandleProps = {
  side: "left" | "right";
  onResizeStart: () => void;
  onResize: (deltaX: number) => void;
  onResizeEnd: () => void;
};

export function TripleLayoutResizeHandle({
  side,
  onResizeStart,
  onResize,
  onResizeEnd,
}: TripleLayoutResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={side === "left" ? "调整左侧栏宽度" : "调整右侧栏宽度"}
      className="group relative z-10 flex w-0 shrink-0 cursor-col-resize select-none touch-none"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const startX = event.clientX;
        onResizeStart();

        const onMove = (ev: PointerEvent) => {
          onResize(ev.clientX - startX);
        };

        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          onResizeEnd();
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      }}
    >
      <div
        className={`absolute top-0 bottom-0 w-px bg-zinc-200 transition group-hover:bg-sky-400/80 group-active:bg-sky-500 dark:bg-zinc-800 dark:group-hover:bg-sky-600 ${
          side === "left" ? "-left-px" : "-right-px"
        }`}
      />
      <div
        className={`absolute top-0 bottom-0 w-1 -translate-x-1/2 bg-transparent ${
          side === "left" ? "left-0" : "right-0 translate-x-1/2"
        }`}
      />
    </div>
  );
}
