export const state = {
  user: null,
  tickets: [],
  orderTickets: [],
  orders: [],
  erpItems: [],
  customers: [],
  addresses: [],
  customerAccessories: {},
  selectedOrder: null,
  selectedTicket: null,
  specs: {},
  currentLabel: null,
  currentLabelHtml: '',
  labelHandlersBound: false,
  cartonTotalBound: false,
  statusSelectBound: false,
  sizeEditorBound: false,
  cartonDefaults: null,
  sizeList: [],
  labelCartons: [],
  activeCartonIndex: 0,
  timelineEntries: [],
  timelineExpanded: false,
  techpackSpec: null,
  techpackActiveMedia: null,
  techpackContext: null,
  techpackAnnotationStageBound: false,
  techpackRequestedView: null,
  activeArtikelCode: null,
  activeCustomerId: null,
  shoeboxRows: [],
  shoeboxSeason: 'FS',
  shoeboxYear: new Date().getFullYear(),
  orderDeliveryEvents: [],
  manualCalendarEvents: [],
  calendarRange: 'month',
  diagnostics: null,
  diagnosticsInterval: null,
  orderPrintOptions: null,
  autosync: {
    status: null,
    logs: [],
    lastResult: null,
    metrics: null,
    errors: []
  },
  orderDraft: null,
  orderDraftSaveTimeout: null,
  orderDraftEditingId: null,
  proformaDraft: null,
  proformaReadOnly: true,
  proformaArchive: [],
  locale: 'de',
  translations: {},
  translationObserver: null,
  missingTranslations: new Set(),
  translationManager: {
    locale: 'tr',
    locales: ['tr'],
    entries: {},
    filter: ''
  },
  orderStatusBusy: false
};

export const SUPPORTED_LOCALES = [
  { code: 'de', label: 'Deutsch' },
  { code: 'tr', label: 'Türkçe' }
];

export const NAV_LINKS = [
  { href: '/dashboard.html', label: 'Dashboard', page: 'dashboard' },
  { href: '/bestellungen.html', label: 'Bestellungen', page: 'bestellungen' },
  { href: '/artikel.html', label: 'Artikel', page: 'artikel' },
  { href: '/kunden.html', label: 'Kunden', page: 'kunden' },
  { href: '/tickets.html', label: 'Tickets', page: 'tickets' },
  { href: '/prozessstatus.html', label: 'Prozessstatus', page: 'prozessstatus' },
  { href: '/lieferanten-guide.html', label: 'Lieferanten-Anleitung', page: 'lieferanten-guide' },
  { href: '/musterrechnung.html', label: 'Muster Proforma', page: 'musterrechnung' },
  { href: '/translations.html', label: 'Übersetzungen', page: 'translations', className: 'bate-only' },
  { href: '/autosync.html', label: 'AutoSync', page: 'autosync', className: 'bate-only' },
  { href: '/diagnostics.html', label: 'Systemstatus', page: 'diagnostics' }
];

export const STATUS_LABELS = {
  ORDER_EINGEREICHT: 'Eingereicht',
  ORDER_BESTAETIGT: 'Bestätigt',
  RUECKFRAGEN_OFFEN: 'Rückfragen offen',
  RUECKFRAGEN_GEKLAERT: 'Rückfragen geklärt',
  PRODUKTION_LAEUFT: 'Produktion läuft',
  WARE_ABHOLBEREIT: 'Versandbereit',
  UEBERGEBEN_AN_SPEDITION: 'Abgeschlossen'
};

export const STATUS_FLOW = [
  'ORDER_EINGEREICHT',
  'ORDER_BESTAETIGT',
  'RUECKFRAGEN_OFFEN',
  'RUECKFRAGEN_GEKLAERT',
  'PRODUKTION_LAEUFT',
  'WARE_ABHOLBEREIT',
  'UEBERGEBEN_AN_SPEDITION'
];

export const STATUS_CHOICES = [
  { code: 'ORDER_EINGEREICHT', label: STATUS_LABELS.ORDER_EINGEREICHT },
  { code: 'ORDER_BESTAETIGT', label: STATUS_LABELS.ORDER_BESTAETIGT },
  { code: 'RUECKFRAGEN_OFFEN', label: STATUS_LABELS.RUECKFRAGEN_OFFEN },
  { code: 'PRODUKTION_LAEUFT', label: STATUS_LABELS.PRODUKTION_LAEUFT },
  { code: 'WARE_ABHOLBEREIT', label: STATUS_LABELS.WARE_ABHOLBEREIT },
  { code: 'UEBERGEBEN_AN_SPEDITION', label: STATUS_LABELS.UEBERGEBEN_AN_SPEDITION }
];

export const ORDER_TYPE_BADGE_META = {
  MUSTER: { label: 'MUSTER', badgeClass: 'order-type-muster' },
  SMS: { label: 'SMS', badgeClass: 'order-type-sms' },
  PPS: { label: 'PPS', badgeClass: 'order-type-pps' },
  BESTELLUNG: { label: 'BESTELLUNG', badgeClass: 'order-type-bestellung' }
};

export const ACCESSORY_SLOTS = [
  { key: 'shoe_box', label: 'Schuhbox', description: 'Primäre Kartonage inklusive Branding.' },
  { key: 'tissue_paper', label: 'Seidenpapier', description: 'Innenliegendes Papier für jedes Paar.' },
  { key: 'dust_bag', label: 'Stoffbeutel', description: 'Schutzbeutel oder Sleeves pro Paar.' }
];

export const EYE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 662" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false" webcrx=""><metadata>Created by potrace 1.15, written by Peter Selinger 2001-2017</metadata><g transform="translate(0,662) scale(0.1,-0.1)" fill="currentColor"><path d="M6330 6609 c-1718 -102 -3518 -884 -5200 -2260 -336 -274 -685 -593 -956 -873 l-173 -178 91 -99 c144 -156 523 -517 803 -764 1394 -1232 2845 -2012 4275 -2299 486 -97 816 -130 1320 -130 383 -1 517 7 845 49 1372 176 2726 781 3982 1781 517 411 1037 915 1406 1362 l78 93 -27 32 c-463 555 -984 1081 -1491 1504 -1537 1283 -3211 1885 -4953 1782z m464 -584 c362 -42 679 -139 1002 -304 957 -491 1538 -1464 1501 -2511 -22 -585 -223 -1125 -593 -1590 -87 -109 -314 -336 -424 -424 -403 -322 -876 -525 -1410 -607 -214 -33 -590 -33 -810 0 -560 83 -1055 305 -1470 656 -119 101 -310 302 -403 423 -298 389 -481 840 -542 1332 -30 243 -15 583 35 831 237 1162 1221 2047 2440 2193 160 19 514 20 674 1z"/><path d="M6325 4819 c-557 -58 -1040 -395 -1274 -889 -180 -380 -196 -802 -47 -1188 166 -430 522 -771 959 -917 203 -68 276 -79 527 -79 212 0 232 1 345 28 147 34 230 64 360 126 437 210 750 611 852 1090 28 130 25 469 -4 600 -58 259 -165 475 -334 677 -331 394 -863 606 -1384 552z"/></g></svg>`;

export const TRASH_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 875 1000" aria-hidden="true" focusable="false"><path fill="currentColor" d="M0 281.296l0 -68.355q1.953 -37.107 29.295 -62.496t64.449 -25.389l93.744 0l0 -31.248q0 -39.06 27.342 -66.402t66.402 -27.342l312.48 0q39.06 0 66.402 27.342t27.342 66.402l0 31.248l93.744 0q37.107 0 64.449 25.389t29.295 62.496l0 68.355q0 25.389 -18.553 43.943t-43.943 18.553l0 531.216q0 52.731 -36.13 88.862t-88.862 36.13l-499.968 0q-52.731 0 -88.862 -36.13t-36.13 -88.862l0 -531.216q-25.389 0 -43.943 -18.553t-18.553 -43.943zm62.496 0l749.952 0l0 -62.496q0 -13.671 -8.789 -22.46t-22.46 -8.789l-687.456 0q-13.671 0 -22.46 8.789t-8.789 22.46l0 62.496zm62.496 593.712q0 25.389 18.553 43.943t43.943 18.553l499.968 0q25.389 0 43.943 -18.553t18.553 -43.943l0 -531.216l-624.96 0l0 531.216zm62.496 -31.248l0 -406.224q0 -13.671 8.789 -22.46t22.46 -8.789l62.496 0q13.671 0 22.46 8.789t8.789 22.46l0 406.224q0 13.671 -8.789 22.46t-22.46 8.789l-62.496 0q-13.671 0 -22.46 -8.789t-8.789 -22.46zm31.248 0l62.496 0l0 -406.224l-62.496 0l0 406.224zm31.248 -718.704l374.976 0l0 -31.248q0 -13.671 -8.789 -22.46t-22.46 -8.789l-312.48 0q-13.671 0 -22.46 8.789t-8.789 22.46l0 31.248zm124.992 718.704l0 -406.224q0 -13.671 8.789 -22.46t22.46 -8.789l62.496 0q13.671 0 22.46 8.789t8.789 22.46l0 406.224q0 13.671 -8.789 22.46t-22.46 8.789l-62.496 0q-13.671 0 -22.46 -8.789t-8.789 -22.46zm31.248 0l62.496 0l0 -406.224l-62.496 0l0 406.224zm156.24 0l0 -406.224q0 -13.671 8.789 -22.46t22.46 -8.789l62.496 0q13.671 0 22.46 8.789t8.789 22.46l0 406.224q0 13.671 -8.789 22.46t-22.46 8.789l-62.496 0q-13.671 0 -22.46 -8.789t-8.789 -22.46zm31.248 0l62.496 0l0 -406.224l-62.496 0l0 406.224z"/></svg>`;

export const SIZE_COLUMNS = ['36', '37', '38', '39', '40', '41', '42'];

export const TECHPACK_VIEWS = [
  { key: 'side', label: 'Seitenansicht', position: 1 },
  { key: 'front', label: 'Vorderansicht', position: 2 },
  { key: 'inner', label: 'Innenansicht', position: 3 },
  { key: 'rear', label: 'Hinteransicht', position: 4 },
  { key: 'top', label: 'Draufsicht', position: 5 },
  { key: 'bottom', label: 'Unteransicht', position: 6 },
  { key: 'sole', label: 'Sohle', position: 7 },
  { key: 'tongue', label: 'Zunge', position: 8 }
];

export const TECHPACK_MEDIA_STATUS = {
  OPEN: { label: 'OFFEN', badgeClass: 'warning', toggleLabel: 'Status auf OK setzen' },
  OK: { label: 'OK', badgeClass: 'success', toggleLabel: 'Status auf Offen setzen' }
};

export const TRANSLATABLE_ATTRIBUTES = ['placeholder', 'aria-label', 'title'];

export const VAT_RATE = 0.19;
