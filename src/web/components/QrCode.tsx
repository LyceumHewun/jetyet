import QRCode from "qrcode";
import { useId, useMemo } from "react";
import { t as translate } from "../i18n";
import { Button, CopyButton } from "./primitives";
import { Modal, ModalBody } from "./workspace";

const QUIET_ZONE = 4;

/**
 * Renders a scannable local SVG QR code for the exact subscription URL.
 */
export function QrCodeSvg({
  value,
  label,
  size = 184,
}: {
  value: string;
  label: string;
  size?: number;
}) {
  const titleId = useId();
  const matrix = useMemo(() => {
    try {
      const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
      const count = qr.modules.size;
      const total = count + QUIET_ZONE * 2;
      let path = "";
      for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
          if (qr.modules.get(row, col)) {
            path += `M${col + QUIET_ZONE},${row + QUIET_ZONE}h1v1h-1z`;
          }
        }
      }
      return { total, path };
    } catch {
      return null;
    }
  }, [value]);

  if (!matrix) {
    return (
      <p className="muted" role="status">
        {translate("Unable to generate QR code.")}
      </p>
    );
  }

  return (
    <svg
      className="qr-svg"
      viewBox={`0 0 ${matrix.total} ${matrix.total}`}
      width={size}
      height={size}
      role="img"
      aria-labelledby={titleId}
      shapeRendering="crispEdges"
    >
      <title id={titleId}>{label}</title>
      <rect className="qr-bg" width={matrix.total} height={matrix.total} />
      <path className="qr-fg" d={matrix.path} />
    </svg>
  );
}

/**
 * Focused flat modal showing a scannable QR code for an exact HTTPS URL.
 */
export function QrCodeModal({
  title,
  tag,
  url,
  onClose,
}: {
  title: string;
  tag?: string;
  url: string;
  onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      tag={tag ?? translate("Subscription QR Code")}
      subtitle={translate(
        "Scan this QR code with a compatible client to import the subscription URL.",
      )}
      onClose={onClose}
      className="qr-dialog"
    >
      <ModalBody>
        <figure className="qr-figure">
          <div className="qr-frame">
            <QrCodeSvg
              value={url}
              label={translate("Subscription QR code for {0}", title)}
              size={200}
            />
          </div>
          <figcaption className="qr-caption mono">{url}</figcaption>
        </figure>
      </ModalBody>
      <div className="modal-foot">
        <CopyButton text={url} label={translate("Copy link")} variant="default" />
        <Button variant="primary" onClick={onClose}>
          {translate("Done")}
        </Button>
      </div>
    </Modal>
  );
}
