/**
 * Punto de venta (lo usan el empleado en su página y el admin en una ventana).
 *
 * Flujo: elegir productos → cobrar en efectivo (con vuelto) o por transferencia
 * (banco + foto del comprobante) → venta registrada. En transferencias, el
 * comprobante se comparte a WhatsApp con el detalle de la venta y quién la hizo.
 */
import { useMemo, useState } from "react";
import { HONDURAS_BANKS } from "./config.js";
import { money, stockStatus } from "./format.js";
import { Icon } from "./icons.jsx";
import { compressImage, shareImageWithText } from "./media.js";
import { Empty, ErrorBox, Field, Loading, Modal, ProductImage, Switch, useLoader, useToast } from "./ui.jsx";
import { saleReceiptMessage } from "./whatsapp.js";

// ─── Carrito ────────────────────────────────────────────────────────

function useCart() {
  const [lines, setLines] = useState([]); // [{ product, qty }]
  const add = (product) =>
    setLines((ls) => {
      const found = ls.find((l) => l.product.id === product.id);
      if (found) return ls.map((l) => (l.product.id === product.id ? { ...l, qty: Math.min(l.qty + 1, product.stock) } : l));
      return [...ls, { product, qty: 1 }];
    });
  const setQty = (id, qty) =>
    setLines((ls) => ls.flatMap((l) => (l.product.id !== id ? [l] : qty <= 0 ? [] : [{ ...l, qty: Math.min(qty, l.product.stock) }])));
  const clear = () => setLines([]);
  const subtotal = lines.reduce((s, l) => s + l.product.finalPrice * l.qty, 0);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  return { lines, add, setQty, clear, subtotal, count };
}

function computeTotals(subtotal, discount, includeTax, taxRate) {
  const d = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  const tax = includeTax ? Math.round((subtotal - d) * taxRate * 100) / 100 : 0;
  return { discount: d, tax, total: Math.round((subtotal - d + tax) * 100) / 100 };
}

// ─── Catálogo del punto de venta ────────────────────────────────────

function ProductPicker({ products, categories, cart, lowStock }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todos");
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter(
      (p) =>
        (category === "Todos" || p.category === category) &&
        (!q || `${p.name} ${p.brand} ${p.sku}`.toLowerCase().includes(q)),
    );
  }, [products, query, category]);

  const inCart = (id) => cart.lines.find((l) => l.product.id === id)?.qty ?? 0;

  return (
    <div className="stack">
      <div className="input-icon">
        <Icon name="search" size={16} />
        <input className="input" placeholder="Buscar por nombre, marca o código…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="chips scroll-x">
        {["Todos", ...categories].map((c) => (
          <button key={c} className={`chip ${category === c ? "active" : ""}`} onClick={() => setCategory(c)}>{c}</button>
        ))}
      </div>
      {visible.length === 0 ? (
        <Empty icon="search" title="Sin resultados">Probá con otra búsqueda o categoría.</Empty>
      ) : (
        <div className="grid" style={{ "--min": "150px", "--gap": "10px" }}>
          {visible.map((p) => {
            const qty = inCart(p.id);
            const status = stockStatus(p.stock - qty, lowStock);
            const soldOut = p.stock - qty <= 0;
            return (
              <button key={p.id} className={`pos-tile ${qty ? "selected" : ""}`} onClick={() => cart.add(p)} disabled={soldOut}>
                {qty > 0 && <span className="counter accent">{qty}</span>}
                <ProductImage product={p} className="pos-tile-img" />
                <span className="pos-tile-name">{p.name}</span>
                <span className="row between wrap" style={{ width: "100%", "--gap": "4px" }}>
                  <span className={`price small nowrap ${p.offerPrice ? "offer" : ""}`}>{money(p.finalPrice)}</span>
                  <span className={`badge ${status.tone}`}>{soldOut && qty ? "Sin más" : status.label}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Resumen del carrito ────────────────────────────────────────────

function CartPanel({ cart, discount, setDiscount, includeTax, setIncludeTax, taxRate, onCheckout }) {
  const totals = computeTotals(cart.subtotal, discount, includeTax, taxRate);
  return (
    <div className="stack">
      <div className="row between">
        <h3 className="card-title">Venta actual</h3>
        {cart.count > 0 && <button className="btn btn-sm btn-ghost" onClick={cart.clear}><Icon name="trash" size={14} /> Vaciar</button>}
      </div>
      {cart.lines.length === 0 ? (
        <Empty icon="cart" title="Todavía no agregaste productos">Tocá un producto para sumarlo.</Empty>
      ) : (
        <div>
          {cart.lines.map(({ product, qty }) => (
            <div className="list-row" key={product.id}>
              <ProductImage product={product} />
              <div className="grow">
                <div className="truncate small strong">{product.name}</div>
                <div className="tiny muted mono">{money(product.finalPrice)} c/u</div>
              </div>
              <div className="row" style={{ "--gap": "4px" }}>
                <button className="icon-btn sm" onClick={() => cart.setQty(product.id, qty - 1)} aria-label="Quitar uno"><Icon name="minus" size={14} /></button>
                <span className="mono" style={{ minWidth: 22, textAlign: "center" }}>{qty}</span>
                <button className="icon-btn sm" onClick={() => cart.setQty(product.id, qty + 1)} disabled={qty >= product.stock} aria-label="Agregar uno"><Icon name="plus" size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid-2">
        <Field label="Descuento (L.)">
          <input className="input mono" type="number" min="0" step="0.01" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0.00" />
        </Field>
        <div className="field" style={{ justifyContent: "flex-end", paddingBottom: 9 }}>
          <Switch checked={includeTax} onChange={setIncludeTax} label="Cobrar ISV 15%" />
        </div>
      </div>

      <div className="pos-totals">
        <div className="row between small muted"><span>Subtotal</span><span className="mono">{money(cart.subtotal)}</span></div>
        {totals.discount > 0 && <div className="row between small muted"><span>Descuento</span><span className="mono">-{money(totals.discount)}</span></div>}
        {includeTax && <div className="row between small muted"><span>ISV 15%</span><span className="mono">{money(totals.tax)}</span></div>}
        <div className="row between"><strong>Total</strong><strong className="mono" style={{ fontSize: 22 }}>{money(totals.total)}</strong></div>
      </div>

      <div className="grid-2">
        <button className="btn btn-lg btn-ok" disabled={!cart.count} onClick={() => onCheckout("efectivo", totals)}><Icon name="cash" /> Efectivo</button>
        <button className="btn btn-lg btn-primary" disabled={!cart.count} onClick={() => onCheckout("transferencia", totals)}><Icon name="bank" /> Transferencia</button>
      </div>
    </div>
  );
}

// ─── Cobro ──────────────────────────────────────────────────────────

function quickCash(total) {
  const options = new Set([total]);
  for (const step of [100, 500, 1000]) options.add(Math.ceil(total / step) * step);
  return [...options].sort((a, b) => a - b).slice(0, 4);
}

function CashCheckout({ total, onConfirm, busy }) {
  const [received, setReceived] = useState("");
  const value = Number(received) || 0;
  const change = value - total;
  return (
    <div className="stack">
      <div className="pos-due"><span className="muted small">Total a cobrar</span><strong className="mono">{money(total)}</strong></div>
      <Field label="¿Con cuánto paga?">
        <input className="input mono btn-lg" type="number" min="0" step="0.01" inputMode="decimal" autoFocus value={received} onChange={(e) => setReceived(e.target.value)} placeholder="0.00" />
      </Field>
      <div className="chips" style={{ flexWrap: "wrap" }}>
        {quickCash(total).map((v) => (
          <button key={v} className="chip" onClick={() => setReceived(String(v))}>{v === total ? "Exacto" : money(v)}</button>
        ))}
      </div>
      {value > 0 && (
        <div className={`alert ${change >= 0 ? "ok" : "danger"}`}>
          <Icon name={change >= 0 ? "check" : "alert"} />
          <span>{change >= 0 ? <>Vuelto: <strong className="mono">{money(change)}</strong></> : <>Faltan {money(-change)}</>}</span>
        </div>
      )}
      <button className="btn btn-ok btn-lg btn-block" disabled={busy || change < 0 || !value} onClick={() => onConfirm({ cashReceived: value })}>
        {busy ? <span className="spinner" /> : "Confirmar venta"}
      </button>
    </div>
  );
}

function TransferCheckout({ total, banks, onConfirm, busy, uploadReceipt }) {
  const names = banks.length ? banks.map((b) => b.bank) : HONDURAS_BANKS;
  const [bank, setBank] = useState(names[0]);
  const [receipt, setReceipt] = useState(null); // dataUrl
  const [error, setError] = useState(null);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setError(null);
      setReceipt(await compressImage(file, { maxSize: 1400, quality: 0.85 }));
    } catch (err) {
      setError(err);
    }
  };

  const confirm = async () => {
    try {
      setError(null);
      const { id } = await uploadReceipt(receipt);
      await onConfirm({ bank, receiptImageId: id, receiptDataUrl: receipt });
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="stack">
      <div className="pos-due"><span className="muted small">Total transferido</span><strong className="mono">{money(total)}</strong></div>
      <div className="field">
        <span>Banco</span>
        <div className="chips" style={{ flexWrap: "wrap" }}>
          {names.map((n) => <button key={n} className={`chip ${bank === n ? "active" : ""}`} onClick={() => setBank(n)}>{n}</button>)}
        </div>
      </div>
      <div className="field">
        <span>Foto del comprobante</span>
        {receipt ? (
          <div className="receipt-preview">
            <img src={receipt} alt="Comprobante" />
            <label className="btn btn-sm btn-ghost"><Icon name="refresh" size={14} /> Cambiar<input type="file" accept="image/*" hidden onChange={pick} /></label>
          </div>
        ) : (
          <label className="upload-box">
            <Icon name="camera" size={26} />
            <strong>Tomar o subir foto</strong>
            <span className="tiny muted">Se guarda en el panel admin y se comparte a WhatsApp</span>
            <input type="file" accept="image/*" hidden onChange={pick} />
          </label>
        )}
      </div>
      <ErrorBox error={error} />
      <button className="btn btn-primary btn-lg btn-block" disabled={busy || !receipt} onClick={confirm}>
        {busy ? <span className="spinner" /> : "Confirmar venta"}
      </button>
    </div>
  );
}

function SaleDone({ sale, receiptDataUrl, store, onClose }) {
  const toast = useToast();
  const [shared, setShared] = useState(false);
  const isTransfer = sale.paymentMethod === "transferencia";

  const share = async () => {
    const result = await shareImageWithText({
      dataUrl: receiptDataUrl,
      fileName: `comprobante-venta-${sale.id}.jpg`,
      text: saleReceiptMessage(sale, store.name),
      fallbackPhone: store.whatsapp,
    });
    if (result === "whatsapp") toast("Se abrió WhatsApp con el detalle. La foto quedó guardada en el panel admin.", "info", 6000);
    if (result !== "cancelled") setShared(true);
  };

  return (
    <div className="stack" style={{ alignItems: "center", textAlign: "center", "--gap": "14px" }}>
      <div className="done-mark"><Icon name="check" size={34} strokeWidth={2.4} /></div>
      <div>
        <h3>Venta #{sale.id} registrada</h3>
        <p className="muted small">Vendió {sale.seller.name} · {isTransfer ? `Transferencia ${sale.bank}` : "Efectivo"}</p>
      </div>
      <div className="pos-due" style={{ width: "100%" }}><span className="muted small">Total</span><strong className="mono">{money(sale.total)}</strong></div>
      {sale.paymentMethod === "efectivo" && (
        <div className="alert ok" style={{ width: "100%" }}>
          <Icon name="cash" /><span>Recibido {money(sale.cashReceived)} · Vuelto <strong className="mono">{money(sale.change)}</strong></span>
        </div>
      )}
      {isTransfer && (
        <button className="btn btn-wa btn-lg btn-block" onClick={share}>
          <Icon name="whatsapp" /> {shared ? "Enviar de nuevo" : "Enviar comprobante a WhatsApp"}
        </button>
      )}
      <button className={`btn btn-block ${isTransfer && !shared ? "btn-ghost" : "btn-primary"}`} onClick={onClose}>Nueva venta</button>
    </div>
  );
}

// ─── Componente principal ───────────────────────────────────────────

export function Pos({ api, onSale }) {
  const catalog = useLoader(() => api.get("/api/staff/catalog"), []);
  const cart = useCart();
  const [discount, setDiscount] = useState("");
  const [includeTax, setIncludeTax] = useState(false);
  const [checkout, setCheckout] = useState(null); // { method, totals }
  const [done, setDone] = useState(null); // { sale, receiptDataUrl }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);

  if (catalog.loading && !catalog.data) return <Loading />;
  if (catalog.error) return <ErrorBox error={catalog.error} onRetry={catalog.reload} />;
  const { store, products, taxRate } = catalog.data;

  const startCheckout = (method, totals) => {
    setError(null);
    setCartOpen(false);
    setCheckout({ method, totals });
  };

  const confirm = async (payment) => {
    setBusy(true);
    setError(null);
    try {
      const { receiptDataUrl, ...rest } = payment;
      const { sale } = await api.post("/api/staff/sales", {
        items: cart.lines.map((l) => ({ productId: l.product.id, qty: l.qty })),
        paymentMethod: checkout.method,
        discount: Number(discount) || 0,
        includeTax,
        ...rest,
      });
      setDone({ sale, receiptDataUrl });
      setCheckout(null);
      cart.clear();
      setDiscount("");
      catalog.reload(true);
      onSale?.(sale);
    } catch (err) {
      setError(err);
      if (err.status === 409 || /stock/i.test(err.message)) catalog.reload(true);
    } finally {
      setBusy(false);
    }
  };

  const cartPanel = (
    <CartPanel
      cart={cart}
      discount={discount}
      setDiscount={setDiscount}
      includeTax={includeTax}
      setIncludeTax={setIncludeTax}
      taxRate={taxRate}
      onCheckout={startCheckout}
    />
  );

  return (
    <div className="pos">
      <section className="pos-products">
        <ProductPicker products={products} categories={store.categories} cart={cart} lowStock={3} />
      </section>
      <aside className="pos-cart card hide-mobile">{cartPanel}</aside>

      {cart.count > 0 && (
        <button className="pos-cart-bar only-mobile" onClick={() => setCartOpen(true)}>
          <span className="row"><Icon name="cart" /> {cart.count} {cart.count === 1 ? "producto" : "productos"}</span>
          <strong className="mono">{money(computeTotals(cart.subtotal, discount, includeTax, taxRate).total)}</strong>
        </button>
      )}
      {cartOpen && <Modal title="Venta actual" onClose={() => setCartOpen(false)}>{cartPanel}</Modal>}

      {checkout && (
        <Modal title={checkout.method === "efectivo" ? "Cobro en efectivo" : "Cobro por transferencia"} onClose={() => !busy && setCheckout(null)}>
          {checkout.method === "efectivo" ? (
            <CashCheckout total={checkout.totals.total} onConfirm={confirm} busy={busy} />
          ) : (
            <TransferCheckout
              total={checkout.totals.total}
              banks={store.banks}
              busy={busy}
              onConfirm={confirm}
              uploadReceipt={(dataUrl) => api.post("/api/images", { purpose: "comprobante", dataUrl })}
            />
          )}
          <ErrorBox error={error} />
        </Modal>
      )}

      {done && (
        <Modal onClose={() => setDone(null)} title="Venta lista">
          <SaleDone sale={done.sale} receiptDataUrl={done.receiptDataUrl} store={store} onClose={() => setDone(null)} />
        </Modal>
      )}
    </div>
  );
}
