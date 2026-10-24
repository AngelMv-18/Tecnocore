/**
 * Productos: alta, edición, fotos (subir desde el celular/PC o pegar un link),
 * ofertas, stock rápido y ocultar/eliminar.
 */
import { useMemo, useState } from "react";
import { assetUrl } from "../shared/api.js";
import { money, stockStatus } from "../shared/format.js";
import { Icon } from "../shared/icons.jsx";
import { compressImage } from "../shared/media.js";
import { PageHead } from "../shared/Shell.jsx";
import { Badge, Confirm, Empty, ErrorBox, Field, Loading, Modal, ProductImage, Switch, useAction, useForm, useLoader } from "../shared/ui.jsx";

const EMPTY = { name: "", category: "", brand: "", specs: "", price: "", offerPrice: "", stock: "1", sku: "", imageId: null, imageUrl: "", active: true };

function fromProduct(p) {
  return {
    name: p.name, category: p.category, brand: p.brand ?? "", specs: p.specs ?? "",
    price: String(p.price), offerPrice: p.offerPrice ? String(p.offerPrice) : "", stock: String(p.stock), sku: p.sku ?? "",
    imageId: p.imageId, imageUrl: p.externalImageUrl ?? "", active: p.active,
  };
}

/** Selector de foto: subir archivo (se comprime) o usar un link https. */
function PhotoPicker({ api, form, setForm }) {
  const [mode, setMode] = useState(form.imageUrl && !form.imageId ? "link" : "upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const preview = form.imageId ? assetUrl(`/api/images/${form.imageId}`) : form.imageUrl;

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await compressImage(file, { maxSize: 1200, quality: 0.85 });
      const { id } = await api.post("/api/images", { purpose: "producto", dataUrl });
      setForm((f) => ({ ...f, imageId: id, imageUrl: "" }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field">
      <span>Foto</span>
      <div className="photo-picker">
        <div className="photo-preview">
          {busy ? <span className="spinner" /> : preview ? <img src={preview} alt="Vista previa" onError={(e) => { e.currentTarget.style.opacity = 0.2; }} /> : <Icon name="image" size={30} className="faint" />}
        </div>
        <div className="stack grow" style={{ "--gap": "8px" }}>
          <div className="chips">
            <button type="button" className={`chip ${mode === "upload" ? "active" : ""}`} onClick={() => setMode("upload")}><Icon name="upload" size={13} /> Subir</button>
            <button type="button" className={`chip ${mode === "link" ? "active" : ""}`} onClick={() => setMode("link")}><Icon name="link" size={13} /> Link</button>
          </div>
          {mode === "upload" ? (
            <label className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }}>
              <Icon name="camera" size={15} /> {form.imageId ? "Cambiar foto" : "Elegir foto"}
              <input type="file" accept="image/*" hidden onChange={upload} />
            </label>
          ) : (
            <input className="input" placeholder="https://…/foto.jpg" value={form.imageUrl} onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value.trim(), imageId: null }))} />
          )}
          {(form.imageId || form.imageUrl) && (
            <button type="button" className="link tiny" onClick={() => setForm((f) => ({ ...f, imageId: null, imageUrl: "" }))}><Icon name="trash" size={12} /> Quitar foto</button>
          )}
        </div>
      </div>
      {error ? <small className="error">{error.message}</small> : <small className="hint">JPG o PNG. Se achica sola para que cargue rápido.</small>}
    </div>
  );
}

function ProductForm({ api, product, categories, onSaved, onClose }) {
  const [form, set, setForm] = useForm(product ? fromProduct(product) : { ...EMPTY, category: categories[0] ?? "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const price = Number(form.price) || 0;
  const offer = Number(form.offerPrice) || 0;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { ...form, offerPrice: form.offerPrice === "" ? null : form.offerPrice };
      const { product: saved } = product ? await api.put(`/api/admin/products/${product.id}`, body) : await api.post("/api/admin/products", body);
      onSaved(saved, !product);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={product ? "Editar producto" : "Nuevo producto"} onClose={onClose} size="wide">
      <form className="stack" onSubmit={submit}>
        <PhotoPicker api={api} form={form} setForm={setForm} />
        <Field label="Nombre"><input className="input" required value={form.name} onChange={set("name")} placeholder="Ej.: NVIDIA RTX 4070 Super 12GB" /></Field>
        <div className="grid-2">
          <Field label="Categoría">
            <select className="select" value={form.category} onChange={set("category")}>
              {[...new Set([...categories, form.category].filter(Boolean))].map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Marca"><input className="input" value={form.brand} onChange={set("brand")} /></Field>
        </div>
        <Field label="Características" hint="Una por línea: se muestran como lista en la ficha">
          <textarea className="textarea" value={form.specs} onChange={set("specs")} maxLength={500} placeholder={"12GB GDDR6X\nDLSS 3\n220W"} />
        </Field>
        <div className="grid-2">
          <Field label="Precio (L.)"><input className="input mono" required type="number" min="0" step="0.01" inputMode="decimal" value={form.price} onChange={set("price")} /></Field>
          <Field label="Precio de oferta (L.)" hint={offer > 0 && price > 0 ? (offer < price ? `-${Math.round((1 - offer / price) * 100)}% de descuento` : "Tiene que ser menor al precio") : "Vacío = sin oferta"}>
            <input className="input mono" type="number" min="0" step="0.01" inputMode="decimal" value={form.offerPrice} onChange={set("offerPrice")} />
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Stock (unidades)"><input className="input mono" required type="number" min="0" step="1" inputMode="numeric" value={form.stock} onChange={set("stock")} /></Field>
          <Field label="Código / SKU" hint="Se genera solo si lo dejás vacío"><input className="input mono" value={form.sku} onChange={set("sku")} /></Field>
        </div>
        <Switch checked={form.active} onChange={set("active")} label="Visible en la tienda" />
        <ErrorBox error={error} />
        <div className="row end">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? <span className="spinner" /> : product ? "Guardar cambios" : "Crear producto"}</button>
        </div>
      </form>
    </Modal>
  );
}

export function Products({ api, store }) {
  const { data, error, loading, reload, setData } = useLoader(() => api.get("/api/admin/products"), []);
  const [run] = useAction();
  const [editing, setEditing] = useState(null); // producto | "new"
  const [deleting, setDeleting] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("todos");

  const products = useMemo(() => data?.products ?? [], [data]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (filter === "ofertas" && !p.offerPrice) return false;
      if (filter === "bajo" && p.stock > store.lowStock) return false;
      if (filter === "ocultos" && p.active) return false;
      return !q || `${p.name} ${p.brand} ${p.sku} ${p.category}`.toLowerCase().includes(q);
    });
  }, [products, query, filter, store.lowStock]);

  const replace = (p) => setData((d) => ({ products: d.products.some((x) => x.id === p.id) ? d.products.map((x) => (x.id === p.id ? p : x)) : [p, ...d.products] }));
  const adjust = (p, delta) => run(async () => replace((await api.patch(`/api/admin/products/${p.id}/stock`, { delta })).product));
  const toggle = (p) => run(async () => replace((await api.put(`/api/admin/products/${p.id}`, { ...fromProduct(p), active: !p.active })).product), p.active ? "Producto oculto de la tienda" : "Producto visible en la tienda");

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;

  return (
    <>
      <PageHead title="Productos" subtitle={`${products.length} productos · ${products.filter((p) => p.active).length} visibles en la tienda`}>
        <button className="btn btn-primary" onClick={() => setEditing("new")}><Icon name="plus" size={16} /> Nuevo producto</button>
      </PageHead>
      <div className="catalog-tools" style={{ marginBottom: 10 }}>
        <div className="input-icon grow"><Icon name="search" size={16} /><input className="input" placeholder="Buscar…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      </div>
      <div className="chips scroll-x" style={{ marginBottom: 14 }}>
        {[["todos", "Todos"], ["ofertas", "En oferta"], ["bajo", "Stock bajo"], ["ocultos", "Ocultos"]].map(([k, l]) => (
          <button key={k} className={`chip ${filter === k ? "active" : ""}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      {visible.length === 0 ? <Empty icon="box" title="No hay productos acá" /> : (
        <div className="stack" style={{ "--gap": "8px" }}>
          {visible.map((p) => {
            const st = stockStatus(p.stock, store.lowStock);
            return (
              <div key={p.id} className={`card flat product-row ${p.active ? "" : "inactive"}`}>
                <button className="product-row-main" onClick={() => setEditing(p)}>
                  <ProductImage product={p} className="thumb lg" />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="strong truncate">{p.name}</div>
                    <div className="tiny muted">{p.category}{p.brand ? ` · ${p.brand}` : ""} · <span className="mono">{p.sku}</span></div>
                    <div className="row" style={{ "--gap": "8px", marginTop: 4 }}>
                      {p.offerPrice && <span className="price-old">{money(p.price)}</span>}
                      <span className={`price small ${p.offerPrice ? "offer" : ""}`}>{money(p.finalPrice)}</span>
                      {!p.active && <Badge>Oculto</Badge>}
                      <span className="tiny faint row" style={{ "--gap": "3px" }}><Icon name="eye" size={12} /> {p.views}</span>
                    </div>
                  </div>
                </button>
                <div className="product-row-side">
                  <div className="row" style={{ "--gap": "4px" }}>
                    <button className="icon-btn sm" onClick={() => adjust(p, -1)} disabled={p.stock === 0} aria-label="Restar stock"><Icon name="minus" size={14} /></button>
                    <span className={`badge ${st.tone}`} style={{ minWidth: 54, justifyContent: "center" }}>{p.stock} u.</span>
                    <button className="icon-btn sm" onClick={() => adjust(p, 1)} aria-label="Sumar stock"><Icon name="plus" size={14} /></button>
                  </div>
                  <div className="row" style={{ "--gap": "4px" }}>
                    <button className="icon-btn sm" onClick={() => setEditing(p)} aria-label="Editar"><Icon name="edit" size={14} /></button>
                    <button className="icon-btn sm" onClick={() => toggle(p)} aria-label={p.active ? "Ocultar" : "Mostrar"} title={p.active ? "Ocultar de la tienda" : "Mostrar en la tienda"}><Icon name={p.active ? "eye" : "ban"} size={14} /></button>
                    <button className="icon-btn sm" onClick={() => setDeleting(p)} aria-label="Eliminar"><Icon name="trash" size={14} /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <ProductForm
          api={api}
          product={editing === "new" ? null : editing}
          categories={store.categories}
          onClose={() => setEditing(null)}
          onSaved={(p, created) => { replace(p); setEditing(null); run(async () => {}, created ? "Producto creado" : "Cambios guardados"); }}
        />
      )}
      {deleting && (
        <Confirm
          title="¿Eliminar producto?"
          message={`"${deleting.name}" se borra del catálogo. Las ventas pasadas no se modifican. Si solo querés que no se vea, usá Ocultar.`}
          confirmLabel="Eliminar"
          danger
          onConfirm={() => run(async () => { await api.del(`/api/admin/products/${deleting.id}`); setData((d) => ({ products: d.products.filter((x) => x.id !== deleting.id) })); }, "Producto eliminado")}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}
