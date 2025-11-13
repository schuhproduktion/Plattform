const fs = require('fs/promises');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

const defaults = {
  'users.json': [
    {
      id: 'u-bate-1',
      email: 'anna.bate@example.com',
      password_hash: '$2a$10$xQzZvaznlwQbRDVUcHx1IupWKSCtF9NKiP5FNISORor.4SgNuMF6O',
      role: 'BATE',
      locale: 'de'
    },
    {
      id: 'u-supp-1',
      email: 'supplier.meyer@example.com',
      password_hash: '$2a$10$egTtvwSwQadofo4imQvISuresNR6u2Rd9eOtE93VHG8cZhMyIqcwm',
      role: 'SUPPLIER',
    supplier_id: 'BATE AYAKKABI İMALAT İTHALAT İHRACAT SANAYİ VE TİCARET LİMİTED ŞİRKETİ',
      locale: 'tr'
    }
  ],
  'customers.json': [
    {
      id: 'CUST-001',
      name: 'BATE Footwear GmbH',
      industry: 'Schuhe',
      status: 'aktiv',
      priority: 'hoch',
      account_manager: 'Anna Bate',
      tax_id: 'DE123456789',
      created_at: '2024-01-08T09:00:00.000Z'
    },
    {
      id: 'CUST-002',
      name: 'Nordic Trailwear AG',
      industry: 'Outdoor',
      status: 'aktiv',
      priority: 'mittel',
      account_manager: 'Jonas Wolf',
      tax_id: 'SE987654321',
      created_at: '2024-02-16T10:30:00.000Z'
    }
  ],
  'addresses.json': [
    {
      id: 'ADDR-001',
      customer_id: 'CUST-001',
      type: 'Rechnung',
      street: 'Werkstrasse 12',
      zip: '80331',
      city: 'München',
      country: 'DE'
    },
    {
      id: 'ADDR-002',
      customer_id: 'CUST-002',
      type: 'Lieferung',
      street: 'Lagerstrasse 8',
      zip: '20095',
      city: 'Hamburg',
      country: 'DE'
    }
  ],
  'contacts.json': [
    {
      id: 'CONT-001',
      customer_id: 'CUST-001',
      name: 'Michael Braun',
      role: 'Produktionsleiter',
      email: 'michael.braun@bate-footwear.de',
      phone: '+49 89 1111 2222'
    },
    {
      id: 'CONT-002',
      customer_id: 'CUST-002',
      name: 'Sara Lindholm',
      role: 'Supply Manager',
      email: 's.lindholm@nordictrailwear.com',
      phone: '+46 40 333 444'
    }
  ],
  'items.json': require('./data/items.json'),
  'purchase_orders.json': require('./data/purchase_orders.json'),
  'spec_sheets.json': [
    {
      order_id: 'PO-1001',
      position_id: 'POS-1001-1',
      flags: {
        verstanden: false,
        fertig: false,
        rueckfragen: 2,
        kommentare: [
          {
            id: 'sc-1',
            author: 'supplier.meyer@example.com',
            message: 'Bitte Farbcode RAL bestätigen.',
            ts: '2024-05-10T11:15:00.000Z'
          }
        ],
        medien: []
      },
      files: [
        {
          id: 'file-1001',
          filename: 'farbkarte-pos1.pdf',
          version: 1,
          uploaded_by: 'anna.bate@example.com',
          ts: '2024-05-07T07:10:00.000Z'
        }
      ],
      last_actor: 'supplier.meyer@example.com',
      updated_at: '2024-05-10T11:15:00.000Z'
    },
    {
      order_id: 'PO-1001',
      position_id: 'POS-1001-2',
      flags: {
        verstanden: true,
        fertig: false,
        rueckfragen: 0,
        kommentare: [],
        medien: []
      },
      files: [],
      last_actor: 'anna.bate@example.com',
      updated_at: '2024-05-09T09:00:00.000Z'
    },
    {
      order_id: 'PO-1002',
      position_id: 'POS-1002-1',
      flags: {
        verstanden: true,
        fertig: true,
        rueckfragen: 1,
        kommentare: [
          {
            id: 'sc-2',
            author: 'anna.bate@example.com',
            message: 'Bitte finalen QS-Report hochladen.',
            ts: '2024-05-16T13:00:00.000Z'
          }
        ],
        medien: [
          {
            id: 'media-1',
            label: 'QS-Probe',
            url: '/uploads/orders/PO-1002/positions/POS-1002-1/qs-probe.jpg'
          }
        ]
      },
      files: [
        {
          id: 'file-2001',
          filename: 'laufsohle-v3.dxf',
          version: 3,
          uploaded_by: 'supplier.meyer@example.com',
          ts: '2024-05-15T15:40:00.000Z'
        }
      ],
      last_actor: 'supplier.meyer@example.com',
      updated_at: '2024-05-16T15:40:00.000Z'
    }
  ],
  'tickets.json': [
    {
      id: 'TIC-5001',
      order_id: 'PO-1001',
      position_id: 'POS-1001-1',
      title: 'Unklare Sohlenfarbe',
      status: 'OPEN',
      priority: 'hoch',
      owner: 'u-bate-1',
      watchers: ['u-supp-1'],
      comments: [
        {
          id: 'tc-1',
          author: 'anna.bate@example.com',
          message: 'Bitte die genaue Pantone-Referenz bestätigen.',
          message_de: 'Bitte die genaue Pantone-Referenz bestätigen.',
          message_tr: 'Lütfen kesin Pantone referansını onaylayın.',
          ts: '2024-05-10T09:05:00.000Z'
        }
      ],
      created_at: '2024-05-10T09:00:00.000Z'
    },
    {
      id: 'TIC-5002',
      order_id: 'PO-1002',
      title: 'QS-Report Upload',
      status: 'IN_PROGRESS',
      priority: 'mittel',
      owner: 'u-supp-1',
      watchers: ['u-bate-1'],
      comments: [
        {
          id: 'tc-2',
          author: 'supplier.meyer@example.com',
          message: 'Report folgt heute 16:00 Uhr.',
          message_de: 'Report folgt heute 16:00 Uhr.',
          message_tr: 'Rapor bugün 16:00’da gelecek.',
          ts: '2024-05-16T09:10:00.000Z'
        }
      ],
      created_at: '2024-05-15T08:30:00.000Z'
    }
  ],
  'calendar.json': [
    {
      id: 'CAL-100',
      title: 'PO-1001 Produktion Start',
      type: 'auto',
      order_id: 'PO-1001',
      start: '2024-05-20T06:00:00.000Z',
      end: '2024-05-20T12:00:00.000Z'
    },
    {
      id: 'CAL-101',
      title: 'PO-1002 Versand',
      type: 'auto',
      order_id: 'PO-1002',
      start: '2024-06-25T08:00:00.000Z',
      end: '2024-06-25T10:00:00.000Z'
    },
    {
      id: 'CAL-102',
      title: 'Supplier Jour Fixe',
      type: 'manual',
      order_id: null,
      start: '2024-05-22T09:00:00.000Z',
      end: '2024-05-22T10:00:00.000Z'
    }
  ],
  'status_logs.json': [
    {
      id: 'LOG-1',
      order_id: 'PO-1001',
      position_id: null,
      action: 'STATUS_CHANGE',
      from: 'ORDER_EINGEREICHT',
      to: 'RUECKFRAGEN_OFFEN',
      actor: 'u-bate-1',
      ts: '2024-05-10T10:59:00.000Z'
    },
    {
      id: 'LOG-2',
      order_id: 'PO-1001',
      position_id: 'POS-1001-1',
      action: 'SPEC_COMMENT',
      actor: 'u-supp-1',
      ts: '2024-05-10T11:15:00.000Z'
    },
    {
      id: 'LOG-3',
      order_id: 'PO-1002',
      position_id: null,
      action: 'STATUS_CHANGE',
      from: 'ORDER_BESTAETIGT',
      to: 'PRODUKTION_LAEUFT',
      actor: 'u-supp-1',
      ts: '2024-05-14T06:20:00.000Z'
    }
  ],
  'last_sync.json': {
    last_run: '2024-05-18T09:00:00.000Z',
    source: 'seed'
  },
  'translations.json': {
    locales: {
      tr: {
        'BATE Supplier Portal': 'BATE Tedarikçi Portalı',
        Dashboard: 'Gösterge Paneli',
        Bestellungen: 'Siparişler',
        Artikel: 'Ürünler',
        Kunden: 'Müşteriler',
        Tickets: 'Biletler',
        Kalender: 'Takvim',
        Prozessstatus: 'Süreç Durumu',
        Lieferant: 'Tedarikçi',
        Systemstatus: 'Sistem Durumu',
        'Sprache wählen': 'Dil seç',
        Logout: 'Çıkış',
        Login: 'Giriş',
        'E-Mail': 'E-posta',
        Passwort: 'Şifre',
        'Bitte melden Sie sich mit Ihren Zugangsdaten an.': 'Lütfen giriş bilgilerinizi kullanarak giriş yapın.',
        'Neu laden': 'Yenile',
        'Freigaben fällig': 'Onaylar bekleniyor',
        'Letzter Sync': 'Son senkronizasyon',
        'Neue Bestellungen': 'Yeni siparişler',
        'Offene Tickets': 'Açık biletler',
        'Noch keine Tickets.': 'Henüz bilet yok.',
        'Keine offenen Tickets': 'Açık bilet yok',
        'Keine Daten': 'Veri yok',
        'Keine Bestellungen vorhanden.': 'Hiç sipariş yok.',
        Filtern: 'Filtrele',
        Bestellnummer: 'Sipariş numarası',
        Status: 'Durum',
        Kunde: 'Müşteri',
        Bestellart: 'Sipariş tipi',
        Lieferdatum: 'Teslim tarihi',
        Summe: 'Tutar',
        Alle: 'Hepsi',
        Titel: 'Başlık',
        Priorität: 'Öncelik',
        Kommentare: 'Yorumlar',
        'Keine Timeline-Einträge': 'Zaman çizelgesi boş',
        'Noch keine Antworten.': 'Henüz yanıt yok.',
        'Antwort hinzufügen': 'Yanıt ekle',
        'Antwort (Deutsch)': 'Yanıt (Almanca)',
        'Antwort (Türkisch)': 'Yanıt (Türkçe)',
        'Bitte Deutsch und Türkisch ausfüllen.': 'Lütfen Almanca ve Türkçe metinleri doldurun.',
        'Bitte türkische Antwort eingeben.': 'Lütfen Türkçe yanıt girin.',
        'Kommentar oder Datei erforderlich.': 'Yorum veya dosya gerekli.',
        'Antwort senden': 'Yanıt gönder',
        'Antwort gespeichert': 'Yanıt kaydedildi',
        'Kommentar gelöscht': 'Yorum silindi',
        'Automatisch übersetzen': 'Otomatik çevir',
        'Übersetze...': 'Çevriliyor...',
        'Bitte zuerst Text eingeben.': 'Lütfen önce metni girin.',
        'Automatische Übersetzung nur für BATE verfügbar.': 'Otomatik çeviri yalnızca BATE için kullanılabilir.',
        'DE aktiv · EN/TR vorbereitet': 'DE aktif · EN/TR hazırlanıyor'
      }
    },
    updated_at: '2024-05-18T09:00:00.000Z'
  }
};

async function ensureFile(fileName, data) {
  const filePath = path.join(DATA_DIR, fileName);
  try {
    await fs.access(filePath);
    return false;
  } catch {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    return true;
  }
}

async function run() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  let created = 0;
  for (const [fileName, data] of Object.entries(defaults)) {
    const wasCreated = await ensureFile(fileName, data);
    if (wasCreated) created += 1;
  }
  console.log(created === 0 ? 'Seed-Daten bereits vorhanden.' : `Seed-Daten erstellt (${created} Dateien).`);
}

run();
