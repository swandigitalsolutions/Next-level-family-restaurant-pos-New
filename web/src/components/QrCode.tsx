/**
 * A QR code rendered locally, as an SVG.
 *
 * Generated in the browser rather than fetched from a public QR service: the
 * POS runs on a Pi inside the restaurant and has to keep working with the
 * internet down, and a table card that silently fails to render is a table
 * that cannot order.
 *
 * SVG rather than canvas so it prints at the printer's resolution — these end
 * up laminated on tables, and a blurry code does not scan.
 */
import { useEffect, useState } from "react";
import QRCodeLib from "qrcode";

export function QrCode({ value, size = 180 }: { value: string; size?: number }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    QRCodeLib.toString(value, {
      type: "svg",
      margin: 1,
      width: size,
      // High correction: these get printed, laminated, and then smudged with
      // curry. The extra redundancy is what keeps them scanning.
      errorCorrectionLevel: "H",
      color: { dark: "#2b211a", light: "#ffffff" },
    })
      .then((out) => {
        if (!cancelled) {
          setSvg(out);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (failed) {
    return (
      <div className="qr-fallback" style={{ width: size }}>
        Could not draw this code. The link still works: <code>{value}</code>
      </div>
    );
  }
  if (!svg) return <div className="qr-placeholder" style={{ width: size, height: size }} aria-hidden="true" />;

  return (
    <div
      className="qr-code"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`QR code for ${value}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
