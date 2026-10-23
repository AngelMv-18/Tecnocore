/**
 * Tarjetas de producto, ofertas y la ficha con el botón "Me interesa".
 */
import { useEffect, useState } from "react";
import { money, stockStatus } from "../shared/format.js";
import { Icon } from "../shared/icons.jsx";
import { Badge, ErrorBox, Field, Modal, ProductImage, useToast } from "../shared/ui.jsx";
import { interestMessage, openWhatsApp } from "../shared/whatsapp.js";

export function discountPercent(p) {
  return p.offerPrice ? Math.round((1 - p.offerPrice / p.price) * 100) : 0;
}

function PriceTag({ product, large }) {
  return (
    <div className="stack" style={{ "--gap": "0" }}>
      {product.offerPrice && <span className="price-old">{money(product.price)}</span>}
      <span className={`price ${product.offerPrice ? "offer" : ""}`} style={{ fontSize: large ? 26 : 17 }}>{money(product.finalPrice)}</span>
    </div>
  );
}

function AddButton({ product, cart, block }) {
  const qty = cart.qtyOf(product.id);
  if (product.stock <= 0) return <button className={`btn btn-sm ${block ? "btn-block" : ""}`} disabled>Agotado</button>;
  if (qty === 0) {
    return (
      <button className={`btn btn-primary ${block ? "btn-lg btn-block" : "btn-sm"}`} onClick={(e) => { e.stopPropagation(); cart.add(product); }}>
        <Icon name="cart" size={15} /> Agregar
      </button>
    );
  }
  return (
    <div className={`qty-stepper ${block ? "lg" : ""}`} onClick={(e) => e.stopPropagation()}>
      <button onClick={() => cart.setQty(product, qty - 1)} aria-label="Quitar uno"><Icon name="minus" size={14} /></button>
      <span className="mono">{qty}</span>
      <button onClick={() => cart.add(product)} disabled={qty >= product.stock} aria-label="Agregar uno"><Icon name="plus" size={14} /></button>
    </div>
  );
}

export function ProductCard({ product, cart, onOpen }) {
  const status = stockStatus(product.stock);
  const off = discountPercent(product);
  return (
    <article className="product-card" onClick={() => onOpen(product)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen(product)}>
      <div className="product-media">
        <ProductImage product={product} className="product-img" />
        {off > 0 && <span className="product-off">-{off}%</span>}
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <div className="product-body">
        <div className="tiny faint">{product.brand || product.category}</div>
        <h3 className="product-name">{product.name}</h3>
        {product.specs && <p className="product-specs">{product.specs}</p>}
        <div className="row between" style={{ marginTop: "auto", paddingTop: 8 }}>
          <PriceTag product={product} />
          <AddButton product={product} cart={cart} />
        </div>
      </div>
    </article>
  );
}

export function OffersStrip({ products, cart, onOpen }) {
  const offers = products.filter((p) => p.offerPrice && p.stock > 0);
  if (offers.length === 0) return null;
  return (
    <section className="section">
      <div className="row between" style={{ marginBottom: 12 }}>
        <div>
          <div className="eyebrow">Ofertas</div>
          <h2 className="section-title">Precios especiales <span className="rgb-text">por tiempo limitado</span></h2>
        </div>
      </div>
      <div className="offers-row scroll-x">
        {offers.map((p) => <div key={p.id} className="offer-slot"><ProductCard product={p} cart={cart} onOpen={onOpen} /></div>)}
      </div>
    </section>
  );
}

/** Ficha del producto + "Me interesa" (queda registrado en el panel admin). */
export function ProductDetail({ product, cart, api, store, contact, setContact, onClose, onCheckout }) {
  const toast = useToast();
  const [interest, setInterest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const status = stockStatus(product.stock);

  useEffect(() => {
    api.post(`/api/public/products/${product.id}/view`).catch(() => {});
  }, [api, product.id]);

  const sendInterest = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/public/inquiries", { type: "interes", name: contact.name, phone: contact.phone, productId: product.id });
      toast("¡Listo! La tienda ya sabe que te interesa este producto.");
      openWhatsApp(store.whatsapp, interestMessage(product, contact.name, store.name));
      setInterest(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={product.category} onClose={onClose} size="wide">
      <div className="detail">
        <div className="detail-media">
          <ProductImage product={product} className="detail-img" />
        </div>
        <div className="stack" style={{ "--gap": "14px" }}>
          <div>
            <div className="small faint">{product.brand}</div>
            <h2 style={{ fontSize: 22 }}>{product.name}</h2>
          </div>
          <div className="row between">
            <PriceTag product={product} large />
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          {product.offerPrice && <div className="alert danger" style={{ padding: "8px 12px" }}><Icon name="tag" /> Ahorrás {money(product.price - product.offerPrice)} ({discountPercent(product)}%)</div>}
          {product.specs && (
            <div className="specs">
              {product.specs.split(/\n|·|\|/).map((s) => s.trim()).filter(Boolean).map((s, i) => <div key={i} className="row small"><Icon name="check" size={14} className="faint" /> {s}</div>)}
            </div>
          )}
          <AddButton product={product} cart={cart} block />
          {cart.qtyOf(product.id) > 0 && <button className="btn btn-rgb btn-block" onClick={onCheckout}>Ver carrito y hacer pedido <Icon name="arrowRight" size={15} /></button>}

          {!interest ? (
            <button className="btn btn-ghost btn-block" onClick={() => setInterest(true)}><Icon name="heart" size={16} /> Me interesa, quiero más info</button>
          ) : (
            <form className="card flat stack" style={{ background: "var(--surface-2)" }} onSubmit={sendInterest}>
              <strong className="small">Contanos quién sos y te escribimos</strong>
              <Field label="Tu nombre">
                <input className="input" required value={contact.name} onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))} autoComplete="name" />
              </Field>
              <Field label="Tu WhatsApp (opcional)">
                <input className="input" inputMode="tel" value={contact.phone} onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))} placeholder="9999-9999" autoComplete="tel" />
              </Field>
              <ErrorBox error={error} />
              <button className="btn btn-wa btn-block" disabled={busy}>{busy ? <span className="spinner" /> : <><Icon name="whatsapp" /> Enviar consulta</>}</button>
            </form>
          )}
        </div>
      </div>
    </Modal>
  );
}
