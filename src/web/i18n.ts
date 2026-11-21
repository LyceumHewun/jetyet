import { useSyncExternalStore } from "react";
import { zhHans, type Message } from "./messages";

export type Locale = "en" | "zh-Hans";

const preferenceKey = "jetyet-language";
const listeners = new Set<() => void>();

function browserLocale(): Locale {
  for (const language of navigator.languages) {
    try {
      const tag = new Intl.Locale(language).maximize();
      if (tag.language === "en") return "en";
      if (tag.language === "zh" && tag.script === "Hans") return "zh-Hans";
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }
  return "en";
}

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(preferenceKey);
    if (saved === "en" || saved === "zh-Hans") return saved;
  } catch {
    // Storage can be blocked by the browser.
  }
  return browserLocale();
}

let locale = initialLocale();
document.documentElement.lang = locale;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, () => locale);
}

export function setLocale(next: Locale) {
  try {
    localStorage.setItem(preferenceKey, next);
  } catch {
    // The selection remains active for this visit.
  }
  if (next === locale) return;
  locale = next;
  document.documentElement.lang = next;
  for (const listener of listeners) listener();
}

export function t(message: Message, ...values: (string | number)[]): string {
  const pattern = locale === "zh-Hans" ? zhHans[message] : message;
  if (!values.length) return pattern;
  return pattern.replace(/\{(\d+)\}/g, (token, index: string) => {
    const value = values[Number(index)];
    return typeof value === "number" ? formatNumber(value) : (value ?? token);
  });
}

export type UiError = string | Error;
export type ErrorSummary =
  "Validation failed. {0}" | "SSH connection failed. {0}";

export class RequestError extends Error {
  constructor(
    message: string,
    readonly summary?: ErrorSummary,
  ) {
    super(message);
  }
}

export function asUiError(error: unknown): UiError {
  return error instanceof Error ? error : "Operation failed";
}

export function localizeError(error: UiError) {
  const message = typeof error === "string" ? error : error.message;
  if (Object.hasOwn(zhHans, message)) return localizeMessage(message);
  const status = /^Request failed \((\d{3})\)$/.exec(message);
  if (status) return t("Request failed ({0})", status[1]);
  const summary = error instanceof RequestError ? error.summary : undefined;
  return t(summary ?? "Request failed. {0}", message);
}

export function localizeMessage(message: string) {
  return Object.hasOwn(zhHans, message) ? t(message as Message) : message;
}

const numberFormats = new Map<string, Intl.NumberFormat>();
export function formatNumber(value: number, decimals = 0) {
  const key = `${locale}:${decimals}`;
  let formatter = numberFormats.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    numberFormats.set(key, formatter);
  }
  return formatter.format(value);
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();
export function formatDate(
  value: Date | number,
  options: Intl.DateTimeFormatOptions,
) {
  const key = `${locale}:${JSON.stringify(options)}`;
  let formatter = dateFormats.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(
      locale === "en" ? "en-GB" : locale,
      options,
    );
    dateFormats.set(key, formatter);
  }
  return formatter.format(value);
}
