const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;'
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"'`]/g, (char) => HTML_ESCAPE_MAP[char]);
}

export function escapeAttribute(value) {
  return escapeHtml(value).replace(/\s+/g, ' ').trim();
}

export function sanitizeUrl(value, options = {}) {
  const {
    allowRelative = true,
    allowedProtocols = ['http:', 'https:']
  } = options;

  const raw = String(value ?? '').trim();
  if (!raw) return '';

  if (allowRelative && /^(\/|\.\/|\.\.\/)/.test(raw)) {
    return raw;
  }

  try {
    const parsed = new URL(raw, window.location.origin);
    if (allowedProtocols.includes(parsed.protocol)) {
      return parsed.href;
    }
  } catch (error) {
    return '';
  }

  return '';
}

const LEGACY_TEXT_REPLACEMENTS = [
  ['Â¡', '¡'],
  ['Â¿', '¿'],
  ['Â°', '°'],
  ['Â·', '·'],
  ['Ã¡', 'á'],
  ['Ã©', 'é'],
  ['Ã­', 'í'],
  ['Ã³', 'ó'],
  ['Ãº', 'ú'],
  ['Ã', 'Á'],
  ['Ã‰', 'É'],
  ['Ã', 'Í'],
  ['Ã“', 'Ó'],
  ['Ãš', 'Ú'],
  ['Ã±', 'ñ'],
  ['Ã‘', 'Ñ'],
  ['Ã¼', 'ü'],
  ['Ãœ', 'Ü'],
  ['âœ…', '✅'],
  ['âœ”ï¸', '✔️'],
  ['â³', '⏳'],
  ['âŒ', '❌'],
  ['âš ï¸', '⚠️'],
  ['âš™ï¸', '⚙️'],
  ['â“', '❓'],
  ['â€¢', '•'],
  ['ðŸ“Š', '📊'],
  ['ðŸ“…', '📅'],
  ['ðŸ—ºï¸', '🗺️'],
  ['ðŸšª', '🚪'],
  ['ðŸ’°', '💰'],
  ['ðŸ§‘â€ðŸ’¼', '🧑‍💼'],
  ['ðŸ›Žï¸', '🛎️'],
  ['ðŸ›ï¸', '🛍️'],
  ['ðŸ½ï¸', '🍽️'],
  ['ðŸ§¹', '🧹'],
  ['ðŸ“ˆ', '📈'],
  ['ðŸ› ï¸', '🛠️'],
  ['ðŸ·ï¸', '🏷️'],
  ['ðŸ‘¥', '👥'],
  ['ðŸ”—', '🔗'],
  ['ðŸ“œ', '📜'],
  ['ðŸ›¡ï¸', '🛡️'],
  ['ðŸ”’', '🔒'],
  ['ðŸ‘¤', '👤'],
  ['ðŸ“¦', '📦'],
  ['ðŸ”', '🔍'],
  ['ðŸ§¾', '🧾'],
  ['ðŸ§®', '🧮'],
  ['ðŸ–¨ï¸', '🖨️'],
  ['ðŸ¤”', '🤔']
];

const LEGACY_TEXT_PATTERN = /[ÂÃâð]/;
const NORMALIZABLE_ATTRIBUTES = ['title', 'placeholder', 'aria-label', 'alt'];
const LEGACY_WORD_REPAIRS = [
  [/Habitaci[^\s()\-:,.;]*n/giu, 'Habitacion'],
  [/Extensi[^\s()\-:,.;]*n/giu, 'Extension'],
  [/Recepci[^\s()\-:,.;]*n/giu, 'Recepcion'],
  [/Configuraci[^\s()\-:,.;]*n/giu, 'Configuracion'],
  [/Informaci[^\s()\-:,.;]*n/giu, 'Informacion'],
  [/Acci[^\s()\-:,.;]*n/giu, 'Accion']
];

export function normalizeLegacyText(value) {
  let normalized = String(value ?? '');
  if (!LEGACY_TEXT_PATTERN.test(normalized)) return normalized;

  for (const [legacyValue, cleanValue] of LEGACY_TEXT_REPLACEMENTS) {
    normalized = normalized.split(legacyValue).join(cleanValue);
  }

  for (const [legacyPattern, cleanValue] of LEGACY_WORD_REPAIRS) {
    normalized = normalized.replace(legacyPattern, cleanValue);
  }

  return normalized;
}

function normalizeNodeText(node) {
  if (!node || node.nodeType !== Node.TEXT_NODE) return;
  const normalized = normalizeLegacyText(node.nodeValue);
  if (normalized !== node.nodeValue) {
    node.nodeValue = normalized;
  }
}

function normalizeElementAttributes(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return;

  for (const attributeName of NORMALIZABLE_ATTRIBUTES) {
    const currentValue = element.getAttribute(attributeName);
    if (!currentValue) continue;

    const normalized = normalizeLegacyText(currentValue);
    if (normalized !== currentValue) {
      element.setAttribute(attributeName, normalized);
    }
  }
}

export function normalizeDomText(root) {
  if (!root) return;

  if (root.nodeType === Node.TEXT_NODE) {
    normalizeNodeText(root);
    return;
  }

  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) {
    return;
  }

  if (root.nodeType === Node.ELEMENT_NODE) {
    normalizeElementAttributes(root);
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let currentNode = walker.currentNode;
  while (currentNode) {
    if (currentNode.nodeType === Node.TEXT_NODE) {
      normalizeNodeText(currentNode);
    } else if (currentNode.nodeType === Node.ELEMENT_NODE) {
      normalizeElementAttributes(currentNode);
    }
    currentNode = walker.nextNode();
  }
}

let legacyTextNormalizerObserver = null;

export function installLegacyTextNormalizer(root = document.body) {
  if (!root) return;

  normalizeDomText(root);

  if (legacyTextNormalizerObserver) return;

  let isNormalizing = false;
  legacyTextNormalizerObserver = new MutationObserver((mutations) => {
    if (isNormalizing) return;
    isNormalizing = true;

    try {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          normalizeNodeText(mutation.target);
          continue;
        }

        if (mutation.type === 'attributes') {
          normalizeElementAttributes(mutation.target);
          continue;
        }

        mutation.addedNodes.forEach((node) => {
          normalizeDomText(node);
        });
      }
    } finally {
      isNormalizing = false;
    }
  });

  legacyTextNormalizerObserver.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: NORMALIZABLE_ATTRIBUTES
  });
}
