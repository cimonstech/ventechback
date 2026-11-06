/**
 * Format order_items.selected_variants for display.
 * Never show UUIDs or "[object Object]". Unreadable values are omitted.
 *
 * Known shapes:
 * - Current: { [attributeId]: { id, name|label, value, attribute_name?, price_adjustment } }
 * - Cart-style: same, name = option label
 * - Legacy string map: { Colour: "Black" }
 * - Legacy array: [{ name, value }] / [{ attributeName, option: { label } }]
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim();
    if (!text || text === '[object Object]') return '';
    if (UUID_RE.test(text)) return '';
    return text;
  }
  return '';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pairFromObject(key: string, value: Record<string, unknown>): string | null {
  const attribute =
    cleanText(value.attribute_name) ||
    cleanText(value.attributeName) ||
    cleanText(value.type) ||
    (!UUID_RE.test(key) ? cleanText(key) : '');

  const option =
    cleanText(value.name) ||
    cleanText(value.label) ||
    cleanText(value.value) ||
    (typeof value.option === 'object' && value.option
      ? cleanText((value.option as Record<string, unknown>).label) ||
        cleanText((value.option as Record<string, unknown>).name) ||
        cleanText((value.option as Record<string, unknown>).value)
      : '');

  if (option) {
    if (attribute && attribute.toLowerCase() !== option.toLowerCase()) {
      return `${attribute}: ${option}`;
    }
    return option;
  }
  // Attribute with no readable option (e.g. empty object) → omit.
  return null;
}

function pairsFromUnknown(selected: unknown): string[] {
  if (selected == null || selected === '') return [];

  if (typeof selected === 'string') {
    try {
      const parsed = JSON.parse(selected);
      return pairsFromUnknown(parsed);
    } catch {
      const text = cleanText(selected);
      return text ? [text] : [];
    }
  }

  if (Array.isArray(selected)) {
    return selected
      .map((entry) => {
        if (typeof entry === 'string') return cleanText(entry) || null;
        if (!isPlainObject(entry)) return null;
        return pairFromObject('', entry);
      })
      .filter((part): part is string => Boolean(part));
  }

  if (!isPlainObject(selected)) return [];

  return Object.entries(selected)
    .map(([key, value]) => {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        const option = cleanText(value);
        const attribute = !UUID_RE.test(key) ? cleanText(key) : '';
        if (attribute && option) return `${attribute}: ${option}`;
        return option || null;
      }
      if (isPlainObject(value)) return pairFromObject(key, value);
      return null;
    })
    .filter((part): part is string => Boolean(part));
}

/** "Colour: Black · Storage: 256 GB" or "" if nothing readable. */
export function formatOrderItemOptions(selected: unknown): string {
  const parts = pairsFromUnknown(selected);
  return parts.join(' · ');
}

/** Append options under a product name for emails/PDFs: "iPhone 16 (Colour: Black · Storage: 256 GB)". */
export function productNameWithOptions(productName: string, selected: unknown): string {
  const name = cleanText(productName) || 'Item';
  const options = formatOrderItemOptions(selected);
  return options ? `${name} (${options})` : name;
}
