/**
 * WhatsApp: enlaces wa.me y todos los mensajes que arma el sistema.
 *
 * Una página web no puede mandar mensajes sola (WhatsApp lo bloquea para evitar
 * spam): estos enlaces abren el chat con el texto listo y la persona toca Enviar.
 */
import { money, phone as prettyPhone } from "./format.js";

export function waLink(phoneNumber, text = "") {
  const digits = String(phoneNumber || "").replace(/\D/g, "");
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

export function openWhatsApp(phoneNumber, text) {
  window.open(waLink(phoneNumber, text), "_blank", "noopener");
}

export function telLink(phoneNumber) {
  return `tel:+${String(phoneNumber || "").replace(/\D/g, "")}`;
}

export function mapsLink(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${address}, Honduras`)}`;
}

const itemLines = (items) => items.map((it) => `▫️ ${it.qty}x ${it.name} — ${money(it.lineTotal)}`).join("\n");

// ─── Cliente → tienda ────────────────────────────────────────────────

export function newOrderMessage(order, customer, storeName) {
  const delivery = customer.delivery
    ? `🚚 *Envío a domicilio*\n📍 ${customer.address}`
    : "🏬 *Retiro en tienda*";
  return [
    `🛒 *Nuevo pedido — ${storeName}*`,
    `Pedido #${order.code}`,
    "",
    `👤 *Cliente:* ${customer.name}`,
    `📞 ${prettyPhone(customer.phone.length === 8 ? `504${customer.phone}` : customer.phone)}`,
    "",
    "*Productos:*",
    itemLines(order.items),
    "━━━━━━━━━━━━━",
    `💰 *Total: ${money(order.total)}*`,
    `💳 Método de pago: ${customer.paymentMethod === "transferencia" ? "Transferencia bancaria" : "Efectivo"}`,
    "",
    delivery,
    customer.notes ? `\n📝 ${customer.notes}` : "",
  ].join("\n").trim();
}

export function interestMessage(product, name, storeName) {
  return `Hola ${storeName} 👋, soy ${name}. Me interesa *${product.name}* (${money(product.finalPrice)}). ¿Me dan más información?`;
}

export function helpMessage(type, name, message, orderCode) {
  const title = type === "reporte" ? "⚠️ *Reporte de un problema*" : "🙋 *Necesito ayuda*";
  return [title, `👤 ${name}`, orderCode ? `🔖 Pedido #${orderCode}` : "", "", message].filter((l) => l !== "").join("\n");
}

// ─── Tienda → cliente (plantillas del panel admin) ──────────────────

export const CUSTOMER_TEMPLATES = {
  confirmado: (o, store) =>
    `Hola ${o.customer.name} 👋, te saluda *${store}*.\n\n✅ Confirmamos tu pedido #${o.code} por *${money(o.total)}*.${
      o.delivery ? "\n🚚 En breve te avisamos cuando salga a entrega." : "\n🏬 Ya podés pasar a retirarlo a la tienda."
    }\n\n¡Gracias por tu compra!`,
  en_camino: (o, store) =>
    `Hola ${o.customer.name} 👋, tu pedido #${o.code} de *${store}* ya va en camino 🏍️${o.rider ? ` con ${o.rider.name}` : ""}.\n💰 Total a pagar: *${money(o.total)}*`,
  listo: (o, store) => `Hola ${o.customer.name} 👋, tu pedido #${o.code} ya está listo para retirar en *${store}*. 🏬`,
  entregado: (o, store) => `¡Gracias por tu compra, ${o.customer.name}! 🎮 Tu pedido #${o.code} quedó entregado. Cualquier cosa, estamos a la orden. — *${store}*`,
  transferencia: (o, store, banks = []) =>
    `Hola ${o.customer.name} 👋, para tu pedido #${o.code} (*${money(o.total)}*) podés transferir a:\n\n${
      banks.map((b) => `🏦 *${b.bank}*: ${b.account}${b.holder ? ` (${b.holder})` : ""}`).join("\n") || "🏦 (cargá tus cuentas en Ajustes)"
    }\n\nDespués mandanos la foto del comprobante por acá. ¡Gracias! — *${store}*`,
};

export const INQUIRY_TEMPLATES = {
  interes: (i, store) =>
    `Hola ${i.customer.name} 👋, te saluda *${store}*. Vimos que te interesa *${i.product?.name ?? "uno de nuestros productos"}*. ¿Te ayudamos con alguna duda o te lo apartamos?`,
  ayuda: (i, store) => `Hola ${i.customer.name} 👋, te saluda *${store}*. Recibimos tu consulta:\n\n"${i.message}"\n\n`,
  reporte: (i, store) =>
    `Hola ${i.customer.name} 👋, te saluda *${store}*. Recibimos tu reporte${i.orderCode ? ` sobre el pedido #${i.orderCode}` : ""} y lo estamos revisando. Disculpá las molestias, te escribimos en breve.`,
};

// ─── Tienda → rider ──────────────────────────────────────────────────

export function riderAssignmentMessage(order, store) {
  return [
    `🏍️ *Nuevo envío — ${store}*`,
    `Pedido #${order.code}`,
    "",
    `👤 *Cliente:* ${order.customer.name}`,
    `📞 ${prettyPhone(order.customer.phone)}`,
    `📍 ${order.address}`,
    "",
    "*Pedido:*",
    order.items.map((it) => `▫️ ${it.qty}x ${it.name}`).join("\n"),
    "━━━━━━━━━━━━━",
    `💰 *Cobrar: ${order.paymentMethod === "transferencia" ? "pagado por transferencia" : money(order.total)}*`,
    "",
    "Aceptalo desde tu panel de rider. ¡Gracias!",
  ].join("\n");
}

export function riderReportMessage(inquiry, store) {
  return [
    "⚠️ *Reporte de un cliente*",
    "",
    `Un cliente reportó lo siguiente sobre una entrega tuya${inquiry.orderCode ? ` (pedido #${inquiry.orderCode})` : ""}:`,
    "",
    `"${inquiry.message}"`,
    "",
    "¿Es cierto esto? Por favor respondenos.",
    `Si se confirma, se te aplicará un descuento correspondiente. — *${store}*`,
  ].join("\n");
}

// ─── Empleado → admin (venta por transferencia) ─────────────────────

export function saleReceiptMessage(sale, store) {
  return [
    `🧾 *Venta #${sale.id} — ${store}*`,
    `👤 Vendió: ${sale.seller.name}`,
    `💳 Transferencia · ${sale.bank}`,
    "",
    itemLines(sale.items),
    "━━━━━━━━━━━━━",
    sale.discount ? `Descuento: -${money(sale.discount)}` : "",
    sale.tax ? `ISV 15%: ${money(sale.tax)}` : "",
    `💰 *Total: ${money(sale.total)}*`,
    "",
    "📎 Comprobante adjunto (también queda guardado en el panel admin).",
  ].filter((l) => l !== "").join("\n");
}
