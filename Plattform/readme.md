# BATE Supplier Portal

Monorepo für das B2B Supplier/Produktionsportal (Express Backend + statisches Frontend). Enthält ERP-Fallback-Daten, Cron-Sync, Session-Auth und dateibasierte Persistenz.

## Voraussetzungen

- Node.js >= 18
- npm

## Installation & Start

1. `.env` aus `.env.example` kopieren und Werte setzen.
2. Abhängigkeiten installieren: `npm install`.
3. Seed-Daten sicherstellen (optional): `npm run seed`.
4. Entwicklung starten: `npm run dev` (mit Nodemon) oder produktiv `npm start`.

Der Server läuft standardmäßig auf [http://localhost:8080](http://localhost:8080). Das Frontdoor (`/`) leitet je nach Session nach `/login.html` bzw. `/dashboard.html`.

## Default-Logins

| Rolle    | E-Mail                       | Passwort     |
| -------- | ---------------------------- | ------------ |
| BATE     | `anna.bate@example.com`      | `bate123!`   |
| Supplier | `supplier.meyer@example.com` | `supplier123!` |

## .env Variablen (Beispielwerte)

```
PORT=8080
SESSION_SECRET=change_me
BASE_URL=http://localhost:8080
ERP_URL=https://erp.schuhproduktion.com
ERP_API_KEY=a3da39ca870122d
ERP_API_SECRET=35d3f6beda59e7c
# Optionales Fallback (falls oben nicht gesetzt)
ERP_TOKEN=token123
SYNC_INTERVAL_CRON=*/10 * * * *
AUTOSYNC_SERVICE_URL=http://localhost:5050
AUTOSYNC_SERVICE_TOKEN=super-secret
AUTOSYNC_TIMEOUT_MS=120000
```

`ERP_URL` kann entweder mit oder ohne `/api` angegeben werden – falls der Suffix fehlt, hängt das Backend ihn automatisch an.

### AutoSync-Brücke

Für den vollautomatischen ERP→WooCommerce→Telegram-Flow wird der bestehende Python-Sync (`BATE-AutoSync/core/sync_listener.py`) als eigener Dienst gestartet:

```bash
cd ~/Desktop/BATE-AutoSync
source bateenv/bin/activate  # falls vorhanden
python core/sync_listener.py --port 5050
```

Der Dienst stellt REST-Endpunkte wie `/api/sync/run`, `/api/wc/delete`, `/api/logs/latest` bereit und erwartet optional den Header `X-Autosync-Token`. Das Portal ruft ihn über `AUTOSYNC_SERVICE_URL` auf – der Systemstatus (Diagnose-Seite) sowie neue Admin-Actions (SKU-Sync, manueller Payload, Woo-Löschung, Log-Viewer) sprechen diese Schnittstelle an. Ohne laufenden Dienst bleiben die Buttons automatisch deaktiviert.

## Architektur

- `backend/server.js`: Express-App inkl. Auth, APIs, Cron-Sync (node-cron) und Multer Uploads.
- `backend/lib/*`: Hilfsbibliotheken für ERP-Client (Axios), Workflows, Notifications, Files und Auth.
- `backend/data/*.json`: Dateibasierte Persistenz mit Beispielinhalten (Orders, Specs, Tickets, Kalender, Logs, Notifications, Users etc.).
- `frontend/public`: Statische Seiten (HTML/CSS/JS) für Dashboard, Bestellungen inkl. Detailansicht, Tickets, Kalender usw.
- Uploads landen unter `/uploads/orders/<orderId>/...`.
- Workflow-Layer liefert sprechende Statuslabels (z. B. „Bestellung bestätigt“) und schreibt `portal_status` nach jedem Statuswechsel zurück an ERPNext.

👉 Ausführliches Zielbild inkl. Workflow-, Rollen- und Architektur-Blueprint: `docs/blueprint.md`.

## Techpack Platzhalterbilder

Die Artikelspezifikation zeigt pro Ansicht (Seite, Front etc.) automatisch dein Placeholder-Artwork, wenn für die Position noch kein echtes Techpack-Bild existiert. Lege deine Dateien einfach hier ab:

```
frontend/public/images/techpack-placeholders/
├── side.png
├── front.png
├── inner.png
├── rear.png
├── top.png
├── bottom.png
└── sole.png
```

- Dateiformat beliebig (`.png`, `.jpg`, `.webp`), wichtig ist lediglich der Dateiname je View-Key.
- Nach dem Kopieren ist kein Build nötig – die statischen Assets werden direkt vom Server ausgeliefert.
- Falls eine Datei fehlt, greift automatisch wieder das farbige SVG-Placeholder, sodass die Ansicht nie leer bleibt.

## 1️⃣ Gesamtkonzept – Ziel & Nutzen

**Ziel:** Ein zentrales, rollenbasiertes Portal, das BATE (Deutschland) und Lieferanten (Produktion Istanbul) verbindet, damit Kommunikation über Bestellungen, Artikelpositionen und Spezifikationen transparent, nachvollziehbar und strukturiert bleibt.

**Hauptprobleme heute**

- Kommunikation verteilt auf E-Mail, WhatsApp, Telefon
- Keine durchgängige Rückverfolgung
- Fehlende Transparenz zu Status & Freigaben
- Rückfragen zu Artikeln müssen mühsam rekonstruiert werden

**Lösung in der Plattform**

- Automatischer ERPNext-Pull (Bestellungen, Positionen, Kundeninfos)
- Pro Bestellung & Position zentrale Kommunikations- und Dokumentationsflächen
- Klare Statusphasen & Freigaben inkl. Timeline
- Dateien, Bilder, Änderungen & Kommentare an einem Ort, versioniert
- Vollständige Protokollierung, rollenbasierter Zugriff (BATE, Lieferant, System)

## APIs & Features (Auszug)

- Auth (`/api/login`, `/api/logout`, `/api/session`) über Express-Session + Cookies (1h).
- ERP-Caches (`/api/erp/*`) lesen lokale JSON-Snapshots oder live aus ERPNext (via Axios, Token Auth, `portal_status`-Feld in ERP erforderlich).
- Portal-Orders inkl. Workflow (`/api/orders`, `/api/orders/:id`, `/api/orders/:id/workflow`, Statuswechsel via `PATCH`).
- Spezifikationen pro Position (`/api/specs/...`) mit Kommentaren, Uploads, Flag-Updates und Notifications.
- Tickets CRUD, Calendar Auto+Manual, Notifications, Audit-Logs, Health/Snyc Endpoint.
- **AutoSync Konsole** (`/autosync.html` + `/api/autosync/*`): zeigt Service-Health, Erfolgskennzahlen, Log-Tabelle und erlaubt SKU-Läufe, manuelle Payloads, Woo-Löschungen sowie Log-Queries – alles im Portal-Design.

## Tests

Aktuell keine automatisierten Tests. Empfohlen: Supertest für `/api/health` und `/api/login` (siehe README TODO).

## Weiterentwicklung (Kommentare im Code)

- ERPNext Rückschreiben des `portal_status` (bidirektional) vorbereiten.
- I18n-Struktur für EN/TR im Frontend angelegt.
- SMTP / Browser-Push Hooks in `notify.js` ergänzt (siehe Kommentare) – Umsetzung offen.
- Feingranulare Lieferantenrechte können per Feature-Flag ergänzt werden.
