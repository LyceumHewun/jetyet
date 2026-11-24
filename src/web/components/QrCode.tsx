import QRCode from "qrcode";
import { useEffect, useId, useMemo, useState } from "react";
import { t as translate } from "../i18n";
import { Button, CopyButton, Field } from "./primitives";
import { Select } from "./Select";
import { Modal, ModalBody } from "./workspace";

const QUIET_ZONE = 4;

export type QrCodeOption = {
  value: string;
  label: string;
  url: string;
  tag?: string;
};

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
 * Focused flat modal showing a scannable QR code for an exact HTTPS URL,
 * with an optional format switcher backed by server-provided URLs.
 */
export function QrCodeModal({
  title,
  tag,
  url,
  options,
  optionLabel = translate("Output format"),
  onClose,
}: {
  title: string;
  tag?: string;
  url: string;
  options?: QrCodeOption[];
  optionLabel?: string;
  onClose: () => void;
}) {
  const selectId = useId();
  const [selectedValue, setSelectedValue] = useState(
    () => options?.[0]?.value ?? "",
  );

  useEffect(() => {
    setSelectedValue(options?.[0]?.value ?? "");
  }, [options, url]);

  const activeOption =
    options?.find((opt) => opt.value === selectedValue) ?? options?.[0];
  const activeUrl = activeOption?.url ?? url;
  const activeTag = activeOption?.tag ?? tag;
  const qrLabel = activeOption ? `${title} · ${activeOption.label}` : title;

  return (
    <Modal
      title={title}
      tag={activeTag ?? translate("Subscription QR Code")}
      subtitle={translate(
        "Scan this QR code with a compatible client to import the subscription URL.",
      )}
      onClose={onClose}
      className="qr-dialog"
    >
      <ModalBody>
        {options && options.length > 0 && (
          <Field label={optionLabel} htmlFor={selectId}>
            <Select
              id={selectId}
              value={activeOption?.value ?? ""}
              options={options.map((opt) => ({
                value: opt.value,
                label: opt.label,
              }))}
              onChange={setSelectedValue}
            />
          </Field>
        )}
        <figure className="qr-figure">
          <div className="qr-frame">
            <QrCodeSvg
              value={activeUrl}
              label={translate("Subscription QR code for {0}", qrLabel)}
              size={200}
            />
          </div>
          <figcaption className="qr-caption mono">{activeUrl}</figcaption>
        </figure>
      </ModalBody>
      <div className="modal-foot">
        <CopyButton
          key={activeUrl}
          text={activeUrl}
          label={translate("Copy link")}
          variant="default"
        />
        <Button variant="primary" onClick={onClose}>
          {translate("Done")}
        </Button>
      </div>
    </Modal>
  );
}
