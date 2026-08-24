import { useEffect, type ReactNode } from "react";

export function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  /**
   * 閉じる前に入力欄のフォーカスを外す。モバイルのソフトウェアキーボードが
   * 開いたまま固まり、Discord本体の操作を受け付けなくなる不具合を避けるための予防策。
   */
  function closeAndBlur() {
    (document.activeElement as HTMLElement | null)?.blur();
    onClose();
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeAndBlur();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && closeAndBlur()}>
      <div className="modal" role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}
