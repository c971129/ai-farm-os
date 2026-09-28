(function (global) {
  "use strict";

  const attributes = 'class="nav-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false"';
  const paths = Object.freeze({
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17h7M17.5 13.5v7"/>',
    twin: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15M15 6v15"/>',
    monitoring: '<path d="M3 12h3l2-6 4 12 3-8 2 2h4"/>',
    devices: '<rect x="6" y="4" width="12" height="16" rx="3"/><path d="M9 8h6M9 12h6M12 16h.01"/>',
    water: '<path d="M12 3s5 5.1 5 9a5 5 0 1 1-10 0c0-3.9 5-9 5-9Z"/><path d="M4 19c2.2-1.5 4.3-1.5 6.3 0M13.7 19c2.2-1.5 4.3-1.5 6.3 0"/>',
    fleet: '<path d="M3 16h18v3H3zM5 16V9h10l3 4h3v3"/><circle cx="7" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/>',
    season: '<path d="M20 8a8 8 0 0 0-14.5-2.9L3 8m18 8a8 8 0 0 1-14.5 2.9L4 16"/><path d="M3 8h5V3m13 13h-5v5"/>',
    history: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
    council: '<circle cx="12" cy="8" r="3"/><path d="M5 20c.5-3.2 3-5 7-5s6.5 1.8 7 5M4 11H2m20 0h-2"/>',
    ai: '<path d="m12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4Z"/><path d="m19 16 .6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6Z"/>',
    assistant: '<path d="M12 3a6 6 0 0 0-6 6v2a4 4 0 0 0 2 3.5V17h8v-2.5A4 4 0 0 0 18 11V9a6 6 0 0 0-6-6Z"/><path d="M9 21h6M10 10h.01M14 10h.01M10 14h4"/>',
    ai_settings: '<path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1"/><circle cx="12" cy="12" r="3.5"/><path d="M19 19h2m-1-1v2"/>',
    tasks: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="m8 9 1.5 1.5L12 7.5M8 15h8"/>',
    diagnosis: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5M8 10.5h5M10.5 8v5"/>',
    workbench: '<path d="M4 5h16v14H4zM4 10h16M9 5v14"/>',
    collab: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="m7.7 7.3 2.9 8.1m5.7-8.1-2.9 8.1M8 6h8"/>',
    agents: '<circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="m7 7 3 3m7-3-3 3m-4 4-3 3m7-3 3 3"/>',
    plants: '<path d="M12 21V11M12 12C7 12 5 8 5 4c4 0 7 2 7 8m0 0c5 0 7-4 7-8-4 0-7 2-7 8"/>',
    robots: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4M8 13h.01M16 13h.01M8 17h8"/>',
    vendors: '<path d="M4 4h16v16H4zM8 8h8M8 12h8M8 16h5"/>',
    postharvest: '<path d="M4 9 12 4l8 5v11H4Z"/><path d="M9 20v-6h6v6M4 9h16"/>',
    assets: '<ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7"/>',
    arch: '<rect x="3" y="4" width="18" height="5" rx="1"/><rect x="6" y="15" width="5" height="5" rx="1"/><rect x="13" y="15" width="5" height="5" rx="1"/><path d="M12 9v3m-3.5 0h7"/>',
  });
  const fallback = '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12h8M12 8v8"/>';
  const has = (id) => Object.prototype.hasOwnProperty.call(paths, id);

  global.FarmNavIcons = Object.freeze({
    ids: Object.freeze(Object.keys(paths)),
    has,
    render: (id) => `<svg ${attributes} data-nav-icon="${has(id) ? id : "fallback"}" aria-hidden="true">${has(id) ? paths[id] : fallback}</svg>`,
  });
})(window);
