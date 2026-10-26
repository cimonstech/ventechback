import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  'h2', 'h3', 'h4', 'p', 'br', 'strong', 'em', 'u', 's', 'blockquote',
  'ul', 'ol', 'li', 'a', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'code', 'pre', 'hr', 'iframe',
];

const YOUTUBE_EMBED_PREFIXES = [
  'https://www.youtube.com/embed/',
  'https://www.youtube-nocookie.com/embed/',
];

export function sanitizeContentHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height'],
      iframe: ['src', 'width', 'height', 'title', 'allow', 'allowfullscreen', 'frameborder'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: {
      iframe: ['https'],
    },
    allowProtocolRelative: false,
    allowIframeRelativeUrls: false,
    allowedIframeHostnames: ['www.youtube.com', 'www.youtube-nocookie.com'],
    disallowedTagsMode: 'discard',
    exclusiveFilter: (frame) => {
      if (frame.tag !== 'iframe') return false;
      const src = frame.attribs.src || '';
      return !YOUTUBE_EMBED_PREFIXES.some((prefix) => src.startsWith(prefix));
    },
    transformTags: {
      a: (tagName, attribs) => {
        const next = { ...attribs };
        if (next.target === '_blank') {
          next.rel = 'noopener noreferrer';
        }
        return { tagName, attribs: next };
      },
    },
  });
}
