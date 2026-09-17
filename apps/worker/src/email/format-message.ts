import { escapeHtml } from './html.js';

function substitute(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    if (!(key in values)) {
      throw new Error(`format-message: missing value for "${key}" in template "${template}"`);
    }
    return values[key] ?? '';
  });
}

export function formatText(template: string, values: Record<string, string>): string {
  return substitute(template, values);
}

// Every interpolated value is HTML-escaped before it lands in the rendered
// markup (docs/steps/1A.7-notifications.md): a display name or request title
// coming from a user is never trusted as-is.
export function formatHtml(template: string, values: Record<string, string>): string {
  const escaped = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, escapeHtml(value)]),
  );
  return substitute(template, escaped);
}
