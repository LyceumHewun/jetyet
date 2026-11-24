import { ExternalLink } from "lucide-react";
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

export type QrCodeTemplateOption = {
  value: string;
  label: string;
  format: string;
  group: "assigned" | "personal";
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
 * with optional format and template switchers backed by server-provided URLs.
 */
export function QrCodeModal({
  title,
  tag,
  url,
  options,
  optionLabel = translate("Output format"),
  templates,
  templateLabel = translate("Template"),
  onClose,
}: {
  title: string;
  tag?: string;
  url: string;
  options?: QrCodeOption[];
  optionLabel?: string;
  templates?: QrCodeTemplateOption[];
  templateLabel?: string;
  onClose: () => void;
}) {
  const selectId = useId();
  const formatHintId = useId();
  const templateSelectId = useId();
  const [selectedFormat, setSelectedFormat] = useState(
    () => options?.[0]?.value ?? "",
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

  useEffect(() => {
    setSelectedFormat(options?.[0]?.value ?? "");
    setSelectedTemplateId("");
  }, [options, templates, url]);

  const activeTemplate = templates?.find(
    (tpl) => tpl.value === selectedTemplateId,
  );
  const effectiveFormat = activeTemplate
    ? activeTemplate.format
    : selectedFormat;
  const formatOptions = useMemo(() => {
    if (!options?.length) return [];
    const base = options.map((opt) => ({ value: opt.value, label: opt.label }));
    if (
      activeTemplate &&
      !base.some((opt) => opt.value === activeTemplate.format)
    ) {
      base.push({
        value: activeTemplate.format,
        label: activeTemplate.tag ?? activeTemplate.format,
      });
    }
    return base;
  }, [options, activeTemplate]);

  const templateSelectOptions = useMemo(() => {
    if (!templates?.length) return [];
    const assigned = templates.filter((tpl) => tpl.group === "assigned");
    const personal = templates.filter((tpl) => tpl.group === "personal");
    const groups = [
      { label: translate("ASSIGNED TEMPLATES"), items: assigned },
      { label: translate("PERSONAL TEMPLATES"), items: personal },
    ]
      .filter((group) => group.items.length > 0)
      .map((group) => ({
        label: group.label,
        options: group.items.map((tpl) => ({
          value: tpl.value,
          label: tpl.label,
        })),
      }));
    return [{ value: "", label: translate("Default") }, ...groups];
  }, [templates]);

  const activeOption =
    options?.find((opt) => opt.value === effectiveFormat) ??
    (activeTemplate ? undefined : options?.[0]);
  const activeUrl = activeTemplate
    ? activeTemplate.url
    : (activeOption?.url ?? url);
  const activeTag = activeTemplate
    ? (activeTemplate.tag ?? activeOption?.tag ?? tag)
    : (activeOption?.tag ?? tag);
  const qrLabel = activeTemplate
    ? `${title} · ${activeTemplate.label}`
    : activeOption
      ? `${title} · ${activeOption.label}`
      : title;
  const formatLocked = !!activeTemplate;
  const formatLockHint = activeTemplate
    ? translate(
        "Locked to {0} by the selected template. Clear template to choose another format.",
        activeTemplate.tag ?? activeTemplate.format,
      )
    : undefined;

  const hasControls =
    templateSelectOptions.length > 0 || formatOptions.length > 0;

  const compactUrlLink = (
    <a
      className="qr-link mono"
      href={activeUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={translate("Open URL")}
    >
      {activeUrl}
    </a>
  );

  const splitUrlLink = (
    <a
      className="qr-link mono"
      href={activeUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={translate("Open URL")}
    >
      <span className="qr-link-text">{activeUrl}</span>
      <ExternalLink size={13} className="qr-link-icon" aria-hidden="true" />
    </a>
  );

  const controls = hasControls ? (
    <div className="qr-controls">
      {templateSelectOptions.length > 0 && (
        <Field label={templateLabel} htmlFor={templateSelectId}>
          <Select
            id={templateSelectId}
            unclipped
            value={activeTemplate?.value ?? ""}
            options={templateSelectOptions}
            onChange={setSelectedTemplateId}
          />
        </Field>
      )}
      {formatOptions.length > 0 && (
        <Field
          label={optionLabel}
          htmlFor={selectId}
          hint={formatLockHint}
          hintId={formatLockHint ? formatHintId : undefined}
        >
          <Select
            id={selectId}
            unclipped
            aria-describedby={formatLockHint ? formatHintId : undefined}
            value={activeOption?.value ?? effectiveFormat}
            disabled={formatLocked}
            options={formatOptions}
            onChange={(next) => {
              if (!formatLocked) setSelectedFormat(next);
            }}
          />
        </Field>
      )}
      {splitUrlLink}
    </div>
  ) : null;

  const figure = (
    <figure className="qr-figure">
      <div className="qr-frame">
        <QrCodeSvg
          value={activeUrl}
          label={translate("Subscription QR code for {0}", qrLabel)}
          size={200}
        />
      </div>
      {!hasControls && (
        <figcaption className="qr-caption">{compactUrlLink}</figcaption>
      )}
    </figure>
  );

  return (
    <Modal
      title={title}
      tag={activeTag ?? translate("Subscription QR Code")}
      subtitle={translate(
        "Scan this QR code with a compatible client to import the subscription URL.",
      )}
      onClose={onClose}
      className={hasControls ? "qr-dialog qr-dialog-split" : "qr-dialog"}
    >
      <ModalBody>
        {hasControls ? (
          <div className="qr-layout">
            {controls}
            {figure}
          </div>
        ) : (
          figure
        )}
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
