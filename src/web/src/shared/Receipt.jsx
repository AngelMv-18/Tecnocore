/**
 * Comprobante de transferencia (imagen privada): se descarga con la sesión
 * y se puede reenviar a WhatsApp junto con el detalle de la venta.
 */
import { useEffect, useState } from "react";
import { Icon } from "./icons.jsx";
import { shareImageWithText } from "./media.js";
import { useToast } from "./ui.jsx";
import { saleReceiptMessage } from "./whatsapp.js";

function blobToDataUrl(blobUrl) {
  return fetch(blobUrl)
    .then((r) => r.blob())
    .then((blob) => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    }));
}

export function ReceiptImage({ api, sale, store }) {
  const [src, setSrc] = useState(null);
  const [error, setError] = useState(null);
  const toast = useToast();

  useEffect(() => {
    let url = null;
    let alive = true;
    api.privateImage(sale.receiptUrl).then(
      (u) => { url = u; if (alive) setSrc(u); },
      (e) => alive && setError(e),
    );
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [api, sale.receiptUrl]);

  const share = async () => {
    const result = await shareImageWithText({
      dataUrl: await blobToDataUrl(src),
      fileName: `comprobante-venta-${sale.id}.jpg`,
      text: saleReceiptMessage(sale, store?.name ?? "Tecnocore"),
      fallbackPhone: store?.whatsapp ?? "",
    });
    if (result === "whatsapp") toast("Tu navegador no permite adjuntar la foto: se abrió WhatsApp solo con el texto.", "info", 6000);
  };

  if (error) return <div className="alert danger"><Icon name="alert" /> {error.message}</div>;
  return (
    <div className="stack" style={{ "--gap": "8px" }}>
      <span className="small muted">Comprobante</span>
      <div className="receipt-preview">
        {src ? <a href={src} target="_blank" rel="noreferrer"><img src={src} alt={`Comprobante de la venta ${sale.id}`} /></a> : <div className="page-loading" style={{ minHeight: 140 }}><span className="spinner" /></div>}
      </div>
      {src && (
        <button className="btn btn-wa btn-block" onClick={share}><Icon name="whatsapp" /> Reenviar a WhatsApp</button>
      )}
    </div>
  );
}
