/**
 * Estado del cliente que vive en su navegador: carrito, datos de contacto
 * (para no volver a escribirlos) y sus últimos pedidos (para seguirlos).
 */
import { useCallback, useEffect, useState } from "react";

function usePersistent(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // almacenamiento no disponible: el carrito vive solo en esta pestaña
    }
  }, [key, value]);
  return [value, setValue];
}

/** Carrito: guarda solo { id, qty }; precios y stock salen siempre del catálogo actual. */
export function useCart(products) {
  const [raw, setRaw] = usePersistent("tecnocore.cart", []);
  const byId = new Map((products ?? []).map((p) => [p.id, p]));

  const lines = raw
    .map(({ id, qty }) => ({ product: byId.get(id), qty }))
    .filter((l) => l.product && l.product.stock > 0)
    .map((l) => ({ ...l, qty: Math.min(l.qty, l.product.stock, 20) }));

  const qtyOf = (id) => lines.find((l) => l.product.id === id)?.qty ?? 0;

  const setQty = useCallback(
    (id, qty) => setRaw((list) => (qty <= 0 ? list.filter((l) => l.id !== id) : list.some((l) => l.id === id) ? list.map((l) => (l.id === id ? { ...l, qty } : l)) : [...list, { id, qty }])),
    [setRaw],
  );

  return {
    lines,
    count: lines.reduce((s, l) => s + l.qty, 0),
    total: Math.round(lines.reduce((s, l) => s + l.product.finalPrice * l.qty, 0) * 100) / 100,
    qtyOf,
    add: (p) => setQty(p.id, Math.min(qtyOf(p.id) + 1, p.stock, 20)),
    setQty: (p, qty) => setQty(p.id, Math.min(qty, p.stock, 20)),
    clear: () => setRaw([]),
  };
}

export function useContact() {
  return usePersistent("tecnocore.contact", { name: "", phone: "", address: "" });
}

export function useMyOrders() {
  const [orders, setOrders] = usePersistent("tecnocore.orders", []);
  const remember = (order) => setOrders((list) => [{ code: order.code, total: order.total, at: new Date().toISOString() }, ...list.filter((o) => o.code !== order.code)].slice(0, 8));
  return [orders, remember];
}
