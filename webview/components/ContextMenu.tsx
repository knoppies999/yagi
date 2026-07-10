import { useEffect } from "react";

export interface MenuItem {
  label?: string;
  danger?: boolean;
  separator?: boolean;
  onClick?: () => void;
}

export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

export function ContextMenu({
  menu,
  onClose,
}: {
  menu: MenuState | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!menu) return;
    const close = () => onClose();
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  return (
    <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
      {menu.items.map((item, i) =>
        item.separator ? (
          <div className="menu-sep" key={i} />
        ) : (
          <div
            className={"menu-item" + (item.danger ? " danger" : "")}
            key={i}
            onClick={() => {
              onClose();
              item.onClick?.();
            }}
          >
            {item.label}
          </div>
        )
      )}
    </div>
  );
}
