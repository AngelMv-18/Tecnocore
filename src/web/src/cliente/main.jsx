/**
 * Tienda (lo que ve el cliente): catálogo, ofertas, carrito, pedido,
 * seguimiento y ayuda. Todo lo que el cliente envía aparece en el panel admin.
 */
import { useMemo, useState } from "react";
import { createApi } from "../shared/api.js";
import { CircuitBackground } from "../shared/background.jsx";
import { PAGES } from "../shared/config.js";
import { Icon } from "../shared/icons.jsx";
import { mount } from "../shared/Portal.jsx";
import { Empty, ErrorBox, Loading, Logo, useLoader } from "../shared/ui.jsx";
import { waLink } from "../shared/whatsapp.js";
import { CartModal } from "./checkout.jsx";
import { OffersStrip, ProductCard, ProductDetail } from "./products.jsx";
import { useCart, useContact, useMyOrders } from "./store.js";
import { HelpModal, TrackModal } from "./support.jsx";

const api = createApi();

const SORTS = {
  destacados: { label: "Destacados", fn: () => 0 },
  menor: { label: "Menor precio", fn: (a, b) => a.finalPrice - b.finalPrice },
  mayor: { label: "Mayor precio", fn: (a, b) => b.finalPrice - a.finalPrice },
};

function Hero({ store, onShop, onHelp }) {
  return (
    <section className="hero">
      <div className="hero-art" aria-hidden="true">
        <img src="assets/hero.jpg" alt="" />
        <div className="hero-glow" />
      </div>
      <div className="container hero-content">
        <div className="eyebrow">Honduras · Envíos a domicilio</div>
        <h1 className="hero-title">
          Armá tu <span className="rgb-text">PC gamer</span><br />con lo mejor del hardware
        </h1>
        <p className="hero-sub">Procesadores, tarjetas de video, memorias y más. Pedís en línea, te confirmamos por WhatsApp y te lo llevamos.</p>
        <div className="row wrap" style={{ "--gap": "10px" }}>
          <button className="btn btn-rgb btn-lg" onClick={onShop}><Icon name="cpu" /> Ver catálogo</button>
          <a className="btn btn-lg btn-ghost" href={waLink(store.whatsapp, `Hola ${store.name} 👋`)} target="_blank" rel="noreferrer"><Icon name="whatsapp" /> Escribinos</a>
        </div>
        <div className="hero-perks">
          <span><Icon name="truck" size={16} /> Entrega a domicilio</span>
          <span><Icon name="bank" size={16} /> Efectivo o transferencia</span>
          <button className="link" onClick={onHelp}><Icon name="help" size={16} /> ¿Dudas? Te asesoramos</button>
        </div>
      </div>
    </section>
  );
}

function Catalog({ products, categories, cart, onOpen }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todos");
  const [sort, setSort] = useState("destacados");
  const [onlyStock, setOnlyStock] = useState(false);

  const counts = useMemo(() => {
    const map = new Map();
    for (const p of products) map.set(p.category, (map.get(p.category) ?? 0) + 1);
    return map;
  }, [products]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products
      .filter((p) => (category === "Todos" || p.category === category) && (!onlyStock || p.stock > 0))
      .filter((p) => !q || `${p.name} ${p.brand} ${p.category} ${p.specs}`.toLowerCase().includes(q))
      .sort((a, b) => (b.stock > 0) - (a.stock > 0) || SORTS[sort].fn(a, b));
  }, [products, query, category, sort, onlyStock]);

  const shownCategories = categories.filter((c) => counts.has(c));

  return (
    <section className="section" id="catalogo">
      <div className="eyebrow">Catálogo</div>
      <h2 className="section-title" style={{ marginBottom: 14 }}>Todos los productos</h2>
      <div className="catalog-tools">
        <div className="input-icon grow">
          <Icon name="search" size={16} />
          <input className="input" type="search" placeholder="Buscar: RTX, Ryzen, 32GB…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="select" style={{ width: "auto" }} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar">
          {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
        </select>
      </div>
      <div className="row between wrap" style={{ margin: "12px 0 16px" }}>
        <div className="chips scroll-x grow">
          {["Todos", ...shownCategories].map((c) => (
            <button key={c} className={`chip ${category === c ? "active" : ""}`} onClick={() => setCategory(c)}>
              {c} <span className="faint tiny">{c === "Todos" ? products.length : counts.get(c)}</span>
            </button>
          ))}
        </div>
        <label className="check small muted"><input type="checkbox" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} /> Solo disponibles</label>
      </div>
      {visible.length === 0 ? (
        <Empty icon="search" title="No encontramos productos">Probá con otra búsqueda o escribinos: lo conseguimos.</Empty>
      ) : (
        <div className="grid" style={{ "--min": "230px", "--gap": "14px" }}>
          {visible.map((p) => <ProductCard key={p.id} product={p} cart={cart} onOpen={onOpen} />)}
        </div>
      )}
    </section>
  );
}

function Footer({ store, onTrack, onHelp }) {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div className="stack" style={{ "--gap": "8px" }}>
          <Logo />
          <p className="small muted">Componentes para PC gaming en Honduras.</p>
        </div>
        <div className="stack small" style={{ "--gap": "6px" }}>
          <button className="link" onClick={onTrack}>Seguir mi pedido</button>
          <button className="link" onClick={onHelp}>Ayuda y reportes</button>
          <a className="link" href={waLink(store.whatsapp)} target="_blank" rel="noreferrer">WhatsApp</a>
        </div>
        <div className="stack tiny" style={{ "--gap": "6px" }}>
          <span className="faint">Acceso del equipo</span>
          <a className="link faint" href={PAGES.admin}>Administración</a>
          <a className="link faint" href={PAGES.empleado}>Empleados</a>
          <a className="link faint" href={PAGES.rider}>Riders</a>
        </div>
      </div>
      <div className="container tiny faint" style={{ paddingTop: 16 }}>© {new Date().getFullYear()} {store.name}</div>
    </footer>
  );
}

function Store() {
  const catalog = useLoader(() => api.get("/api/public/catalog"), []);
  const cart = useCart(catalog.data?.products);
  const [contact, setContact] = useContact();
  const [myOrders, rememberOrder] = useMyOrders();
  const [modal, setModal] = useState(null); // { kind, ...props }

  if (catalog.loading && !catalog.data) return <Loading />;
  if (catalog.error) return <div className="container" style={{ paddingTop: 40 }}><ErrorBox error={catalog.error} onRetry={catalog.reload} /></div>;

  const { store, products } = catalog.data;
  const close = () => setModal(null);
  const open = (kind, props = {}) => setModal({ kind, ...props });
  const scrollToCatalog = () => document.getElementById("catalogo")?.scrollIntoView({ behavior: "smooth" });

  return (
    <>
      <CircuitBackground intensity={0.8} />
      <div className="above-bg">
        <header className="topbar">
          <div className="container topbar-inner">
            <Logo />
            <div className="grow" />
            <button className="btn btn-sm btn-ghost hide-mobile" onClick={() => open("track")}><Icon name="truck" size={15} /> Mi pedido</button>
            <button className="icon-btn only-mobile" onClick={() => open("track")} aria-label="Seguir mi pedido"><Icon name="truck" /></button>
            <button className="icon-btn" onClick={() => open("help")} aria-label="Ayuda"><Icon name="help" /></button>
            <button className="icon-btn cart-btn" onClick={() => open("cart")} aria-label={`Carrito (${cart.count})`}>
              <Icon name="cart" />
              {cart.count > 0 && <span className="counter accent">{cart.count}</span>}
            </button>
          </div>
        </header>

        <Hero store={store} onShop={scrollToCatalog} onHelp={() => open("help")} />
        <main className="container">
          <OffersStrip products={products} cart={cart} onOpen={(p) => open("product", { product: p })} />
          <Catalog products={products} categories={store.categories} cart={cart} onOpen={(p) => open("product", { product: p })} />
        </main>
        <Footer store={store} onTrack={() => open("track")} onHelp={() => open("help")} />
      </div>

      {cart.count > 0 && modal?.kind !== "cart" && (
        <button className="pos-cart-bar floating-cart" onClick={() => open("cart")}>
          <span className="row"><Icon name="cart" /> Ver carrito ({cart.count})</span>
          <strong className="mono">L. {cart.total.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong>
        </button>
      )}

      {modal?.kind === "product" && (
        <ProductDetail product={products.find((p) => p.id === modal.product.id) ?? modal.product} cart={cart} api={api} store={store} contact={contact} setContact={setContact} onClose={close} onCheckout={() => open("cart")} />
      )}
      {modal?.kind === "cart" && (
        <CartModal cart={cart} api={api} store={store} contact={contact} setContact={setContact} onPlaced={(o) => { rememberOrder(o); catalog.reload(true); }} onTrack={(code) => open("track", { code })} onClose={close} />
      )}
      {modal?.kind === "track" && <TrackModal api={api} initialCode={modal.code} myOrders={myOrders} onHelp={(code) => open("help", { orderCode: code })} onClose={close} />}
      {modal?.kind === "help" && <HelpModal api={api} store={store} contact={contact} setContact={setContact} orderCode={modal.orderCode} onClose={close} />}
    </>
  );
}

mount(Store);
