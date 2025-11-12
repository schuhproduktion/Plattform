# Bestellung anlegen – Feldinventar & Mapping

Dieses Dokument fasst alle Felder zusammen, die aktuell in den Bestellansichten (`bestellungen.html`, `bestellung.html`) sichtbar sind, und beschreibt, wie sie beim Anlegen einer neuen Bestellung reproduziert bzw. in einen ERPNext-`Purchase Order` übersetzt werden. Ziel ist ein 1:1 Layout-Reuse – dieselben Karten, Grids und Tabellen werden in einem „Create“-Modus mit Eingabekomponenten statt reinem Read-Only-Text gerendert.

---

## 1. UI-Blöcke & Pflichtfelder

| Block | Sichtbare Felder (DOM-ID) | Datentyp/Quelle | Pflicht beim Create? | Ziel (ERP/Portal) |
| --- | --- | --- | --- | --- |
| **Order Summary Card** | `orderNumber`, `orderTypeSelect`, `orderDelivery`, `orderTotal`, `orderTicketsSummary`, `orderStatusSelect` | Order-Stammdaten (`/api/orders/:id`) | Nummer optional (kann ERP generieren), Bestellart, Lieferdatum, Status obligatorisch | `name`/`naming_series`, `custom_bestellart` oder `order_type`, `schedule_date`, `portal_status` |
| **Absender (dispatch)** | `senderName`, `senderStreet`, `senderCity`, `senderCountry` | `dispatch_address_id` + Snapshot | Ja (mindestens Adresse auswählen) | `dispatch_address`, `dispatch_address_display` |
| **Kunde (billing)** | `customerNameValue`, `customerStreet`, `customerCity`, `customerCountry`, `customerTax` | `customer_snapshot.billing_address` | Kunde & Rechnungsadresse Pflicht | `customer`, `customer_name`, `custom_kunde`, `billing_address` |
| **Lieferadresse** | `deliveryCompany`, `deliveryStreet`, `deliveryCity`, `deliveryCountry` | `shipping_address_id` oder Snapshot | Pflicht | `shipping_address`, `shipping_address_display` |
| **Kundenkontakte** | `customerNumber`, `contactName`, `contactEmail`, `contactPhone` | `customers.json`, `contacts.json` | Kundennummer Pflicht, Kontakt optional | `customer`, `contact_person`, `contact_email`, `contact_phone` |
| **Versanddetails** | `shippingPayer`, `shippingMethod`, `shippingPackaging`, `shippingPickup` | `shipping`-Meta (`deriveShippingMeta`) | Incoterm/Versandart Pflicht | `incoterm`, `shipping_method`, `shipping_rule`, Custom-Felder für Packaging/Payer/Pickup |
| **Positionsliste** | Artikelcard + Größenraster (`positionsList` table) | `positions` Array | Mindestens eine Position, inkl. Menge, Größe, Preis | `items` Child-Tabelle mit `item_code`, `qty`, `schedule_date`, `rate`, `amount`, `warehouse`, `uom`, `zusammenstellung`, `sizes` |
| **Zubehör** | `accessoriesContent` | Bisher Platzhalter | Optional (kann lokales JSON bleiben) | Custom Child-Table oder Portal-only, keine ERP-Pflicht |
| **Summen** | `netAmount`, `taxAmount`, `grossAmount` | Abgeleitet aus Positionen oder `order.total` | Auto-berechnet | `net_total`, `total_taxes_and_charges`, `grand_total` |
| **Tickets & Timeline** | `orderTicketsList`, `timeline` | Portal-only | Bei Create leer | Lokale Collections, keine ERP-Felder |

---

## 2. Detail-Mapping (Portal → ERPNext)

### 2.1 Kopf & Meta

| Portal Key | ERP Field | Hinweise |
| --- | --- | --- |
| `order_number` | `name` / Naming Serie | Wenn leer, ERP vergibt Seriennummer (`naming_series`). UI kann Feld optional lassen. |
| `order_type` | `custom_bestellart` oder `order_type_portal` (Custom) | `normalizeOrderType` akzeptiert `MUSTER`, `SMS`, `PPS`, `BESTELLUNG`. |
| `portal_status` | `portal_status` (Custom Select) | Direkt auf Purchase Order geschrieben, damit Timeline/Workflows funktionieren. |
| `requested_delivery` | `schedule_date` (+ optional `items[].schedule_date`) | UI-Selector füllt beides; ERP erwartet `YYYY-MM-DD`. |
| `currency` | `currency`, `price_list_currency`, `company` | Standard: `EUR` / `BATE GmbH`. |
| `supplier_id` | `supplier` | Für Eigenbestellungen bereits gesetzt; bei Portal-Create ggf. Dropdown. |

### 2.2 Kunde & Adressen

| Portal Feld | ERP Feld | Notiz |
| --- | --- | --- |
| `customer_snapshot.id` | `customer` (Link) | Pflicht. |
| `customer_snapshot.name` | `customer_name` | Schreibweise wie im Portal angezeigt. |
| `customer_snapshot.tax_id` | `tax_id` oder Custom-Feld | Wird für Anzeige & PO-Kopf gespeichert. |
| `billing_address_id` | `billing_address` | UI wählt Adresse aus Stammdaten. |
| `shipping_address_id` | `shipping_address` | Ebenso. |
| `shipping_address_display` | ERP generiert aus Doc; UI speichert string für Snapshot. |
| `dispatch_address_id` | `dispatch_address` | Steuert Absenderkarte. |

### 2.3 Kontakte & Versand

| Portal Feld | ERP Field | Notiz |
| --- | --- | --- |
| `contact.id` | `contact_person` | Optional. |
| `contact.email` | `contact_email` | Optional. |
| `contact.phone` | `contact_phone` | Optional. |
| `shipping.payer` | Custom Feld `shipping_payer` oder Mapping über Incoterm (`EXW` ⇒ Kunde) | Heute aus `incoterm` abgeleitet. |
| `shipping.method` | `shipping_method` oder `shipping_rule` | Dropdown identisch mit Anzeige. |
| `shipping.packaging` | Custom Feld (`shipping_packaging`) | Bisher `taxes_and_charges` Platzhalter. |
| `shipping.pickup` | boolesches Custom Feld | Für UI-Text „Kunde holt Ware ab“. |
| `cartons` / `cartons_total` | Custom Child/Int Feld | Bereits im JSON; kann übernommen werden. |

### 2.4 Positionen

| UI Feld | Portal Key | ERP Child Field |
| --- | --- | --- |
| Artikelcode | `pos.item_code` | `item_code` |
| Beschreibung | `pos.description` | `description` / `item_name` |
| Farbcode | `resolvePositionColorCode` ⇒ `color_code` | Custom Feld `color_code` oder `zusammenstellung` |
| Menge | `pos.quantity` | `qty` |
| Einzelpreis | `pos.rate` (oder aus `items.prices`) | `rate`, `price_list_rate` |
| Gesamtpreis | `pos.amount`/`pos.total` | `amount`, `net_amount` |
| Größenraster | `pos.size_breakdown` | Custom JSON (`sizes`) oder Child „Size Breakdown“ |
| Liefertermin Pos | `pos.schedule_date` | `schedule_date` |
| UOM | `pos.uom` | `uom` |

Die UI-„Artikelspezifikation“-/„Artikel öffnen“-Links bleiben unverändert; sie nutzen `pos.position_id`/`pos.item_code`.

---

## 3. Technische Umsetzungsschritte

### 3.1 Backend
1. **ERP-Client erweitern** (`backend/lib/erpClient.js`):
   - `createPurchaseOrder(payload)` → `POST /resource/Purchase Order`.
   - Hilfsfunktion, um Child-Items (`items`) mitsamt Größen/Custom-Feldern zu serialisieren.
2. **API-Routen** (`backend/server.js`):
   - `POST /api/orders` (Create) – validiert Payload, schreibt nach ERP, triggert direkten Sync oder gibt ERP-Antwort zurück.
   - Optional `POST /api/orders/draft` für lokale Entwürfe, falls ERP offline.
3. **Validation Layer**:
   - Pflichtfelder prüfen (Kunde, Liefer-/Rechnungsadresse, mind. eine Position, Lieferdatum, Bestellart).
   - Feld-Schema (z. B. `Joi` oder Custom) mit klaren Fehlermeldungen.
4. **Sync-Aktualisierung**:
   - Nach erfolgreichem ERP-Create: `syncERPData()` für Einzel-Pull oder lokales Schreiben in `purchase_orders.json`.
5. **Access Control & Audit**:
   - Nur BATE-/Admin-Rollen dürfen POST ausführen.
   - Audit-Log (wer hat Bestellung erstellt, Uhrzeit) → `status_logs.json` / Notifications.

### 3.2 Frontend
1. **Create-Entry Point**:
   - Neuer Button „Bestellung anlegen“ auf `bestellungen.html` (oder im Header).
   - Führt zu `bestellung.html?mode=create` oder separater Seite `bestellung-neu.html`.
2. **UI-Reuse**:
   - Komponenten identisch zu bestehenden Cards, aber Inputs/Selects statt Text (`<input class="summary-value">` usw.).
   - Positionsliste als editierbare Tabelle (inline Inputs, Dropdown für Artikelcode, Modal für Größenraster).
3. **Data Sources**:
   - Beim Öffnen: Laden von `/api/erp/customers`, `/api/erp/addresses`, `/api/erp/contacts`, `/api/erp/items` (bereits in `initBestellung` vorhanden).
4. **State & Validation**:
   - Client-seitige Validierung (Pflichtfelder, Mengen > 0, Summen).
   - Darstellung von Fehlern inline (z. B. `data-error` Styles).
5. **Submission Flow**:
   - `fetch('/api/orders', { method: 'POST', body: JSON… })`.
   - Nach Erfolg: Redirect auf `/bestellung.html?order=<id>` + Toast.
6. **Fallbacks**:
   - Offline/ERP-Error → UI bleibt im Create-Modus, zeigt Fehlermeldung, lässt Draft speichern (lokal in `localStorage` oder Backend-Draft-Endpoint).

---

## 4. Offene Punkte / Entscheidungen
1. **ERP Custom Fields**: Sicherstellen, dass Felder wie `portal_status`, `shipping_payer`, `sizes_json` im DocType existieren.
2. **Naming Series**: Falls UI manuelle Nummern erlaubt, series locken (z. B. `BT-B.YY.#####`). Sonst Feld verstecken.
3. **Größenraster-Speicherung**: Aktuell JSON im Item (`sizes`, `sizes_display`). Für Create braucht es festes Schema oder Child Table. Abstimmung mit ERP-Team nötig.
4. **Zubehör-Modul**: Noch keine ERP-Integration – festlegen, ob diese Daten nur Portal-seitig bleiben oder als Child-Doc („Accessories“) erzeugt werden.
5. **Berechtigungen**: Rollenmatrix definieren (z. B. Lieferanten dürfen keine Orders anlegen, nur BATE).
6. **Automatische Tickets/Timeline**: Beim Anlegen Eintrag erzeugen („Order erstellt im Portal“) für Timeline + Audit.

---

Mit diesem Mapping lassen sich Frontend- und Backend-Aufgaben unmittelbar angehen, ohne das bestehende Design anzufassen – sämtliche Felder, die in den aktuellen View-Seiten sichtbar sind, sind in der Tabelle enthalten und haben ein Zuordnungsziel in ERPNext.
