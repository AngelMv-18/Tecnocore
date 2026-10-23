/**
 * Ajustes: nombre de la tienda, WhatsApp que recibe los pedidos, tarifa del
 * rider, aviso de stock bajo, categorías y cuentas bancarias.
 */
import { useState } from "react";
import { HONDURAS_BANKS } from "../shared/config.js";
import { Icon } from "../shared/icons.jsx";
import { PageHead } from "../shared/Shell.jsx";
import { ErrorBox, Field, useToast } from "../shared/ui.jsx";

export function Settings({ api, settings, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ ...settings, whatsapp: settings.whatsapp, categories: [...settings.categories], banks: settings.banks.map((b) => ({ ...b })) });
  const [newCategory, setNewCategory] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setBank = (i, key, value) => setForm((f) => ({ ...f, banks: f.banks.map((b, j) => (j === i ? { ...b, [key]: value } : b)) }));

  const addCategory = () => {
    const c = newCategory.trim();
    if (c && !form.categories.includes(c)) setForm((f) => ({ ...f, categories: [...f.categories, c] }));
    setNewCategory("");
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { settings: saved } = await api.put("/api/admin/settings", form);
      onSaved(saved);
      toast("Ajustes guardados");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save}>
      <PageHead title="Ajustes" subtitle="Datos de la tienda que usan la página del cliente y los paneles.">
        <button className="btn btn-primary" disabled={busy}>{busy ? <span className="spinner" /> : <><Icon name="check" size={16} /> Guardar</>}</button>
      </PageHead>
      <ErrorBox error={error} />
      <div className="grid" style={{ "--min": "320px", "--gap": "16px", marginTop: 12 }}>
        <section className="card stack">
          <h3 className="card-title">Tienda</h3>
          <Field label="Nombre de la tienda"><input className="input" required value={form.storeName} onChange={set("storeName")} /></Field>
          <Field label="WhatsApp de la tienda" hint="Acá llegan los pedidos, consultas y comprobantes. Con código de país (504…)">
            <input className="input mono" required inputMode="tel" value={form.whatsapp} onChange={set("whatsapp")} />
          </Field>
          <div className="grid-2">
            <Field label="Pago al rider por entrega (L.)"><input className="input mono" required type="number" min="0" step="0.01" value={form.riderFee} onChange={set("riderFee")} /></Field>
            <Field label="Avisar stock bajo desde"><input className="input mono" required type="number" min="0" step="1" value={form.lowStock} onChange={set("lowStock")} /></Field>
          </div>
        </section>

        <section className="card stack">
          <h3 className="card-title">Categorías</h3>
          <div className="chips" style={{ flexWrap: "wrap" }}>
            {form.categories.map((c) => (
              <span key={c} className="chip">
                {c}
                <button type="button" className="link" aria-label={`Quitar ${c}`} onClick={() => setForm((f) => ({ ...f, categories: f.categories.filter((x) => x !== c) }))}><Icon name="close" size={12} /></button>
              </span>
            ))}
          </div>
          <div className="row">
            <input className="input grow" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCategory())} placeholder="Nueva categoría" />
            <button type="button" className="btn btn-ghost" onClick={addCategory}><Icon name="plus" size={15} /> Agregar</button>
          </div>
        </section>

        <section className="card stack" style={{ gridColumn: "1 / -1" }}>
          <div className="row between">
            <h3 className="card-title">Cuentas para transferencias</h3>
            <button type="button" className="btn btn-sm btn-ghost" disabled={form.banks.length >= 8} onClick={() => setForm((f) => ({ ...f, banks: [...f.banks, { bank: HONDURAS_BANKS.find((b) => !f.banks.some((x) => x.bank === b)) ?? "", account: "", holder: "" }] }))}>
              <Icon name="plus" size={14} /> Agregar banco
            </button>
          </div>
          <p className="tiny muted">Los bancos con número de cuenta se le muestran al cliente que elige transferencia. Todos aparecen como opción en el punto de venta.</p>
          {form.banks.map((b, i) => (
            <div key={i} className="bank-row">
              <Field label="Banco">
                <input className="input" list="hn-banks" required value={b.bank} onChange={(e) => setBank(i, "bank", e.target.value)} />
              </Field>
              <Field label="Número de cuenta"><input className="input mono" value={b.account} onChange={(e) => setBank(i, "account", e.target.value)} /></Field>
              <Field label="Titular"><input className="input" value={b.holder} onChange={(e) => setBank(i, "holder", e.target.value)} /></Field>
              <button type="button" className="icon-btn" style={{ alignSelf: "flex-end", marginBottom: 3 }} aria-label="Quitar banco" onClick={() => setForm((f) => ({ ...f, banks: f.banks.filter((_, j) => j !== i) }))}><Icon name="trash" size={15} /></button>
            </div>
          ))}
          <datalist id="hn-banks">{HONDURAS_BANKS.map((b) => <option key={b} value={b} />)}</datalist>
        </section>
      </div>
    </form>
  );
}
