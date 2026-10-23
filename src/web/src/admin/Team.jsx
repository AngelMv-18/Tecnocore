/**
 * Equipo: cuentas de admin, empleados y riders. Las contraseñas las define
 * el admin al crear la cuenta y nunca se muestran ni quedan en el código.
 */
import { useState } from "react";
import { money, phone } from "../shared/format.js";
import { Icon } from "../shared/icons.jsx";
import { PasswordInput } from "../shared/Portal.jsx";
import { PageHead } from "../shared/Shell.jsx";
import { Avatar, Badge, Confirm, Empty, ErrorBox, Field, Loading, Modal, Switch, useAction, useForm, useLoader } from "../shared/ui.jsx";
import { waLink } from "../shared/whatsapp.js";

const ROLES = {
  admin: { label: "Administrador", icon: "settings", tone: "accent", page: "admin.html" },
  empleado: { label: "Empleado", icon: "receipt", tone: "info", page: "empleado.html" },
  rider: { label: "Rider", icon: "bike", tone: "violet", page: "rider.html" },
};

function UserForm({ api, user, onSaved, onClose }) {
  const editing = Boolean(user);
  const [form, set] = useForm(user ? { role: user.role, name: user.name, username: user.username, phone: user.phone ?? "", password: "", active: user.active } : { role: "empleado", name: "", username: "", phone: "", password: "", active: true });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { name: form.name, phone: form.phone, active: form.active, ...(form.password ? { password: form.password } : {}) };
      const result = editing ? await api.put(`/api/admin/users/${user.id}`, body) : await api.post("/api/admin/users", { ...body, role: form.role, username: form.username, password: form.password });
      onSaved(result.user, form.password);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={editing ? `Editar a ${user.name}` : "Nueva cuenta"} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {!editing && (
          <div className="field">
            <span>Rol</span>
            <div className="grid" style={{ "--min": "110px", "--gap": "8px" }}>
              {Object.entries(ROLES).map(([k, r]) => (
                <button type="button" key={k} className={`option ${form.role === k ? "active" : ""}`} onClick={() => set("role")(k)}><Icon name={r.icon} size={16} /> {r.label}</button>
              ))}
            </div>
          </div>
        )}
        <Field label="Nombre"><input className="input" required value={form.name} onChange={set("name")} /></Field>
        <div className="grid-2">
          <Field label="Usuario" hint={editing ? "No se puede cambiar" : "Para iniciar sesión"}>
            <input className="input" required disabled={editing} value={form.username} onChange={(e) => set("username")(e.target.value.toLowerCase().replace(/\s/g, ""))} autoCapitalize="none" />
          </Field>
          <Field label={form.role === "rider" ? "WhatsApp (obligatorio)" : "WhatsApp"}>
            <input className="input" inputMode="tel" required={form.role === "rider"} value={form.phone} onChange={set("phone")} placeholder="9999-9999" />
          </Field>
        </div>
        <Field label={editing ? "Nueva contraseña (opcional)" : "Contraseña"} hint={editing ? "Dejala vacía para no cambiarla. Si la cambiás, se cierra su sesión." : "Mínimo 6 caracteres. Pasásela a la persona en privado."}>
          <PasswordInput value={form.password} onChange={set("password")} autoComplete="new-password" />
        </Field>
        {editing && <Switch checked={form.active} onChange={set("active")} label="Cuenta activa (puede iniciar sesión)" />}
        <ErrorBox error={error} />
        <button className="btn btn-primary btn-block" disabled={busy || (!editing && !form.password)}>{busy ? <span className="spinner" /> : editing ? "Guardar" : "Crear cuenta"}</button>
      </form>
    </Modal>
  );
}

/** Mensaje de WhatsApp con el link de su portal (la contraseña se manda solo si el admin quiere). */
function inviteMessage(user, password) {
  const base = window.location.href.replace(/[^/]*$/, "");
  return `Hola ${user.name} 👋, ya tenés tu cuenta en *Tecnocore* (${ROLES[user.role].label}).\n\n🔗 ${base}${ROLES[user.role].page}\n👤 Usuario: *${user.username}*${password ? `\n🔑 Contraseña: *${password}*` : ""}\n\nTe recomiendo cambiarla al entrar (menú de tu cuenta → Cambiar contraseña).`;
}

export function Team({ api, me }) {
  const { data, error, loading, reload, setData } = useLoader(() => api.get("/api/admin/users"), []);
  const [run] = useAction();
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [invite, setInvite] = useState(null); // { user, password }

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;

  const users = data.users;
  const replace = (u) => setData((d) => ({ users: d.users.some((x) => x.id === u.id) ? d.users.map((x) => (x.id === u.id ? { ...x, ...u } : x)) : [...d.users, u] }));

  return (
    <>
      <PageHead title="Equipo" subtitle="Cuentas para el panel admin, el punto de venta y los riders.">
        <button className="btn btn-primary" onClick={() => setEditing("new")}><Icon name="plus" size={16} /> Nueva cuenta</button>
      </PageHead>
      {Object.entries(ROLES).map(([role, r]) => {
        const list = users.filter((u) => u.role === role);
        return (
          <section key={role} style={{ marginBottom: 20 }}>
            <h3 className="card-title row" style={{ marginBottom: 8 }}><Icon name={r.icon} size={16} /> {r.label}s <span className="faint tiny">{list.length}</span></h3>
            {list.length === 0 ? <Empty icon={r.icon} title={`Sin ${r.label.toLowerCase()}s todavía`} /> : (
              <div className="grid" style={{ "--min": "280px", "--gap": "10px" }}>
                {list.map((u) => (
                  <div key={u.id} className={`card flat stack ${u.active ? "" : "inactive"}`} style={{ "--gap": "10px", opacity: u.active ? 1 : 0.55 }}>
                    <div className="row">
                      <Avatar name={u.name} size={40} />
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="strong truncate">{u.name} {u.id === me.id && <span className="tiny faint">(vos)</span>}</div>
                        <div className="tiny muted">@{u.username}{u.phone ? ` · ${phone(u.phone)}` : ""}</div>
                      </div>
                      {!u.active ? <Badge>Inactiva</Badge> : u.role === "rider" && <Badge tone={u.available ? "ok" : ""}>{u.available ? "Disponible" : "No disponible"}</Badge>}
                    </div>
                    {u.stats && (
                      <div className="row small muted wrap" style={{ "--gap": "14px" }}>
                        <span><Icon name="check" size={13} /> {u.stats.delivered} entregas</span>
                        <span><Icon name="wallet" size={13} /> {money(u.stats.earnings)}</span>
                        {u.stats.active > 0 && <span><Icon name="truck" size={13} /> {u.stats.active} en curso</span>}
                      </div>
                    )}
                    <div className="row wrap" style={{ "--gap": "6px" }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditing(u)}><Icon name="edit" size={14} /> Editar</button>
                      {u.phone && <a className="btn btn-sm btn-ghost" href={waLink(u.phone, inviteMessage(u))} target="_blank" rel="noreferrer"><Icon name="whatsapp" size={14} /> Mandar acceso</a>}
                      {u.role === "rider" && u.active && (
                        <button className="btn btn-sm btn-ghost" onClick={() => run(async () => replace((await api.put(`/api/admin/users/${u.id}`, { available: !u.available })).user))}>
                          {u.available ? "Poner no disponible" : "Poner disponible"}
                        </button>
                      )}
                      {u.id !== me.id && <button className="icon-btn sm" style={{ marginLeft: "auto" }} onClick={() => setRemoving(u)} aria-label="Eliminar"><Icon name="trash" size={14} /></button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {editing && (
        <UserForm
          api={api}
          user={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(u, password) => {
            const created = editing === "new";
            replace(u);
            setEditing(null);
            run(async () => {}, created ? "Cuenta creada" : "Cambios guardados");
            if ((created || password) && u.phone) setInvite({ user: u, password });
          }}
        />
      )}
      {invite && (
        <Modal title="¿Le mandás el acceso?" onClose={() => setInvite(null)}>
          <p className="small muted">Se abre WhatsApp con el link de su portal y su usuario. Incluir la contraseña es opcional: también se la podés decir en persona.</p>
          <a className="btn btn-wa btn-block" href={waLink(invite.user.phone, inviteMessage(invite.user, invite.password))} target="_blank" rel="noreferrer" onClick={() => setInvite(null)}><Icon name="whatsapp" /> Enviar con contraseña</a>
          <a className="btn btn-ghost btn-block" href={waLink(invite.user.phone, inviteMessage(invite.user))} target="_blank" rel="noreferrer" onClick={() => setInvite(null)}>Enviar solo link y usuario</a>
        </Modal>
      )}
      {removing && (
        <Confirm
          title={`¿Eliminar a ${removing.name}?`}
          message="Si ya tiene ventas o entregas, la cuenta se desactiva (para no perder el historial). Si no, se borra."
          confirmLabel="Eliminar"
          danger
          onConfirm={() => run(async () => {
            const { archived } = await api.del(`/api/admin/users/${removing.id}`);
            if (archived) replace({ ...removing, active: false, available: false });
            else setData((d) => ({ users: d.users.filter((x) => x.id !== removing.id) }));
          }, "Listo")}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  );
}
