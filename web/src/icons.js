// 线性图标，统一 24×24 viewBox、描边 currentColor
const stroke = (body, width = 2) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  // 品牌图标：两张叠放的集换式卡牌（前卡带卡面画框），右上方升起两缕蒸汽
  logo: stroke(
    '<path d="M9 6.5V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-.5" opacity=".55"/><rect x="4" y="7.5" width="11.5" height="14" rx="2"/><rect x="6.5" y="10" width="6.5" height="5.5" rx="1"/><path d="M6.5 18.5h4"/><path d="M19.2 2.2c.8.9-.8 1.5 0 2.4" opacity=".8"/><path d="M21.6 3c.8.9-.8 1.5 0 2.4" opacity=".8"/>',
    1.8,
  ),
  home: stroke('<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  gear: stroke(
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  ),
  users: stroke('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>'),
  plus: stroke('<path d="M12 5v14M5 12h14"/>'),
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l12-7z"/></svg>',
  refresh: stroke('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
  arrow: stroke('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  search: stroke('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  alert: stroke('<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.5"/>'),
  info: stroke('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/>'),
  close: stroke('<path d="M6 6l12 12M18 6L6 18"/>'),
  card: stroke('<rect x="5" y="3" width="14" height="18" rx="2"/>'),
  logout: stroke('<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 16l-4-4 4-4M6 12h10"/>'),
  sun: stroke('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: stroke('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
};
