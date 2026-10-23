/**
 * Imágenes y archivos: compresión antes de subir y "compartir" con la hoja nativa
 * del celular (permite mandar la foto del comprobante directo a WhatsApp).
 */
import { openWhatsApp } from "./whatsapp.js";

/** Reduce la foto (máx. `maxSize` px de lado) y la convierte a JPEG liviano. */
export function compressImage(file, { maxSize = 1000, quality = 0.82 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith("image/")) return reject(new Error("Elegí un archivo de imagen (JPG o PNG)"));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff"; // fondo blanco para PNG con transparencia
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la imagen. Probá con otra foto"));
    };
    img.src = url;
  });
}

export function dataUrlToFile(dataUrl, name) {
  const [meta, base64] = dataUrl.split(",");
  const mime = /data:(.*?);/.exec(meta)?.[1] || "image/jpeg";
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new File([bytes], name, { type: mime });
}

/**
 * Comparte imagen + texto con la hoja nativa (en el celular aparece WhatsApp).
 * Si el navegador no puede compartir archivos, abre el chat solo con el texto.
 * Devuelve "shared", "whatsapp" o "cancelled".
 */
export async function shareImageWithText({ dataUrl, fileName, text, fallbackPhone }) {
  try {
    const file = dataUrl ? dataUrlToFile(dataUrl, fileName) : null;
    if (file && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text });
      return "shared";
    }
  } catch (err) {
    if (err?.name === "AbortError") return "cancelled";
  }
  openWhatsApp(fallbackPhone, text);
  return "whatsapp";
}

/** Descarga un CSV (para el contador o Excel). */
export function downloadCsv(fileName, rows) {
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = "﻿" + rows.map((r) => r.map(escape).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Pitido corto para avisos nuevos (pedidos, asignaciones). */
let audioCtx = null;
export function beep() {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain).connect(audioCtx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.35);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.36);
  } catch {
    // sin audio disponible
  }
}

/** Notificación del sistema (si la persona dio permiso). */
export function notify(title, body) {
  try {
    if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
      new Notification(title, { body, icon: "assets/icon.png" });
    }
  } catch {
    // ignorar
  }
}
