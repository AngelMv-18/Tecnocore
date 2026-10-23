/**
 * Carrito → datos de entrega → pedido creado (aparece al instante en el panel
 * admin) → botón para mandar el detalle por WhatsApp a la tienda.
 */
import { useState } from "react";
import { money } from "../shared/format.js";
import { Icon } from "../shared/icons.jsx";
import { Empty, ErrorBox, Field, Modal, ProductImage } from "../shared/ui.jsx";
import { newOrderMessage, waLink } from "../shared/whatsapp.js";

function CartLines({ cart }) {
  return (
    <div>
      {cart.lines.map(({ product, qty }) => (
        <div key={product.id} className="list-row">
          <ProductImage product={product} />
          <div className="grow">
            <div className="small strong truncate">{product.name}</div>
            <div className="tiny mono muted">{money(product.finalPrice)} c/u</div>
          </div>
          <div className="qty-stepper">
            <button onClick={() => cart.setQty(product, qty - 1)} aria-label="Quitar uno"><Icon name={qty === 1 ? "trash" : "minus"} size={14} /></button>
            <span className="mono">{qty}</span>
            <button onClick={() => cart.add(product)} disabled={qty >= product.stock} aria-label="Agregar uno"><Icon name="plus" size={14} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

function OrderForm({ cart, api, contact, setContact, onDone }) {
  const [delivery, setDelivery] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState("efectivo");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const update = (key) => (e) => setContact((c) => ({ ...c, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const customer = { name: contact.name.trim(), phone: contact.phone.replace(/\D/g, ""), delivery, address: contact.address.trim(), paymentMethod, notes: notes.trim() };
    try {
      const order = await api.post("/api/public/orders", { ...customer, items: cart.lines.map((l) => ({ productId: l.product.id, qty: l.qty })) });
      cart.clear();
      onDone(order, customer);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div className="grid-2">
        <Field label="Tu nombre"><input className="input" required value={contact.name} onChange={update("name")} autoComplete="name" /></Field>
        <Field label="Tu WhatsApp"><input className="input" required inputMode="tel" value={contact.phone} onChange={update("phone")} placeholder="9999-9999" autoComplete="tel" /></Field>
      </div>
      <div className="field">
        <span>¿Cómo lo recibís?</span>
        <div className="grid-2">
          <button type="button" className={`option ${delivery ? "active" : ""}`} onClick={() => setDelivery(true)}><Icon name="truck" /> Envío a domicilio</button>
          <button type="button" className={`option ${!delivery ? "active" : ""}`} onClick={() => setDelivery(false)}><Icon name="store" /> Retiro en tienda</button>
        </div>
      </div>
      {delivery && (
        <Field label="Dirección de entrega" hint="Colonia, calle, número de casa y una referencia">
          <textarea className="textarea" required value={contact.address} onChange={update("address")} rows={2} autoComplete="street-address" />
        </Field>
      )}
      <div className="field">
        <span>¿Cómo pagás?</span>
        <div className="grid-2">
          <button type="button" className={`option ${paymentMethod === "efectivo" ? "active" : ""}`} onClick={() => setPaymentMethod("efectivo")}><Icon name="cash" /> Efectivo</button>
          <button type="button" className={`option ${paymentMethod === "transferencia" ? "active" : ""}`} onClick={() => setPaymentMethod("transferencia")}><Icon name="bank" /> Transferencia</button>
        </div>
      </div>
      <Field label="Nota (opcional)"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: llamar antes de llegar" maxLength={500} /></Field>
      <ErrorBox error={error} />
      <button className="btn btn-rgb btn-lg btn-block" disabled={busy}>
        {busy ? <span className="spinner" /> : <>Confirmar pedido · {money(cart.total)}</>}
      </button>
      <p className="tiny faint" style={{ textAlign: "center" }}>Te confirmamos disponibilidad y entrega por WhatsApp.</p>
    </form>
  );
}

function OrderPlaced({ order, customer, store, onTrack, onClose }) {
  const message = newOrderMessage(order, customer, store.name);
  return (
    <div className="stack" style={{ "--gap": "14px" }}>
      <div className="stack" style={{ alignItems: "center", textAlign: "center", "--gap": "10px" }}>
        <div className="done-mark"><Icon name="check" size={34} strokeWidth={2.4} /></div>
        <h3>¡Pedido recibido!</h3>
        <p className="muted small">Ya le llegó a la tienda. Guardá tu número de pedido para seguirlo:</p>
        <div className="order-code mono">{order.code}</div>
      </div>
      <div className="pos-totals">
        {order.items.map((it, i) => <div key={i} className="row between small"><span>{it.qty}x {it.name}</span><span className="mono">{money(it.lineTotal)}</span></div>)}
        <div className="row between"><strong>Total</strong><strong className="mono">{money(order.total)}</strong></div>
      </div>
      {customer.paymentMethod === "transferencia" && (
        <div className="card flat stack" style={{ "--gap": "6px", background: "var(--surface-2)" }}>
          <strong className="small"><Icon name="bank" size={14} /> Datos para transferir</strong>
          {store.banks.length ? store.banks.map((b) => (
            <div key={b.bank} className="small"><strong>{b.bank}:</strong> <span className="mono">{b.account}</span>{b.holder && <span className="muted"> · {b.holder}</span>}</div>
          )) : <span className="small muted">Te los pasamos por WhatsApp.</span>}
          <span className="tiny muted">Mandanos la foto del comprobante por WhatsApp.</span>
        </div>
      )}
      <a className="btn btn-wa btn-lg btn-block" href={waLink(store.whatsapp, message)} target="_blank" rel="noreferrer">
        <Icon name="whatsapp" /> Enviar detalle por WhatsApp
      </a>
      <div className="grid-2">
        <button className="btn btn-ghost" onClick={onTrack}><Icon name="truck" size={16} /> Seguir pedido</button>
        <button className="btn btn-ghost" onClick={onClose}>Seguir comprando</button>
      </div>
    </div>
  );
}

export function CartModal({ cart, api, store, contact, setContact, onPlaced, onTrack, onClose }) {
  const [step, setStep] = useState("cart"); // cart | form | done
  const [placed, setPlaced] = useState(null);

  const titles = { cart: "Tu carrito", form: "Datos del pedido", done: "Pedido enviado" };
  return (
    <Modal title={titles[step]} onClose={onClose}>
      {step === "cart" && (
        cart.count === 0 ? (
          <Empty icon="cart" title="Tu carrito está vacío">Agregá productos del catálogo.</Empty>
        ) : (
          <>
            <CartLines cart={cart} />
            <div className="row between"><strong>Total</strong><strong className="mono" style={{ fontSize: 22 }}>{money(cart.total)}</strong></div>
            <button className="btn btn-rgb btn-lg btn-block" onClick={() => setStep("form")}>Continuar <Icon name="arrowRight" size={16} /></button>
          </>
        )
      )}
      {step === "form" && (
        <>
          <button className="btn btn-sm btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setStep("cart")}><Icon name="arrowLeft" size={14} /> Volver al carrito</button>
          <OrderForm cart={cart} api={api} contact={contact} setContact={setContact} onDone={(order, customer) => { setPlaced({ order, customer }); setStep("done"); onPlaced(order); }} />
        </>
      )}
      {step === "done" && placed && <OrderPlaced order={placed.order} customer={placed.customer} store={store} onTrack={() => onTrack(placed.order.code)} onClose={onClose} />}
    </Modal>
  );
}
