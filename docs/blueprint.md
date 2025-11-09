# BATE Supplier Portal – Zielbild & Funktionsumfang

Dieses Dokument fasst das gewünschte Zielbild der BATE-Plattform zusammen und dient als Referenz für Roadmaps, Entwickler-Briefings und interne Präsentationen.

## 1. Gesamtkonzept
- **Ziel:** Rollenbasiertes Portal, das BATE (DE) und Lieferanten (TR) verbindet.
- **Probleme heute:** Verteilte Kommunikation (Mail/WhatsApp/Telefon), keine Traceability, fehlende Transparenz.
- **Lösung:** Integrierte Plattform mit ERP-Sync, zentraler Kommunikation pro Bestellung & Position, klaren Statusphasen, Datei-/Kommentar-Hub, vollständiger Protokollierung.

## 2. Prozessfluss BATE ↔ Lieferant
| Phase | Verantwortlich | Beschreibung | Plattformaktion |
| --- | --- | --- | --- |
| 1. Bestellung im ERPNext | BATE | Purchase Order mit Positionen anlegen | Sync importiert Order
| 2. ERP-Sync | System | Cron/Webhook zieht Orders, Items, Stammdaten | JSON-Snapshots aktualisiert
| 3. Portal-Bestellung sichtbar | Beide | Bestellung erscheint im Dashboard | Zugriff auf Order & Positionen
| 4. Spezifikationen prüfen | Lieferant | Position auswählen, Specs ansehen | Rückfragen, Dateien, Medien
| 5. Rückfragen klären | Beide | Kommentare auf Positionsebene | Timeline-Update
| 6. Freigabe SMS/PPS | BATE | Status setzen | Timeline + Notification
| 7. Produktionsstart | Lieferant | Produktion markieren | Statusupdate
| 8. Zwischenstand/Uploads | Lieferant | Medien & Berichte | Versionierte Ablage
| 9. Fertig/Versandbereit | Lieferant | Status „Abholbereit“ | Sync zu ERP
| 10. Abschluss | BATE | „Übergeben an Spedition“ | Order wird archiviert

## 3. Workflow & Statusmodell
- **Bestellung:** Eingereicht → Bestätigt → Rückfragen offen → Rückfragen geklärt → Produktion läuft → Abholbereit → Übergeben/Abgeschlossen.
- Visualisierung als Timeline (🔵 🟡 🟠 🟢 🟣 ⚪).
- **Artikelpositionen:** Eigene Detailstatus, kommentierbare Rückfragen, automatische Versionierung.

## 4. Modulübersicht
| Modul | Beschreibung | Zugriff |
| --- | --- | --- |
| Dashboard | KPIs, offene Aktionen, Deadlines | BATE & Lieferant |
| Bestellungen | ERP-Sync Liste, Filter, Status | BATE & Lieferant |
| Spezifikationen | Detailansicht pro Position, Medien, Kommentare | BATE & Lieferant |
| Tickets | Rückfragen-/Fehler-Tracking | BATE & Lieferant |
| Kalender | Auto-/manuelle Termine | BATE |
| Notifications & Timeline | Globale Aktivitäten | BATE & Lieferant |
| Dateien | Uploads, Versionierung, Vorschau | BATE & Lieferant |

## 5. ERPNext-Integration
- Pull via Axios-Token: Orders, Items, Customers, Addresses, Contacts.
- Sync-Zyklus: Cron alle 10 Min + manueller Trigger.
- Mapping: `purchase_order.name → order_id`, `purchase_order_item.item_code → artikelnummer`, etc.
- Neues ERP-Feld `portal_status` mit gleichen Statuswerten für bidirektionale Synchronisation; das Portal schreibt Statuswechsel direkt zurück in ERPNext, sobald Workflows ausgelöst werden.

## 6. Rollen & Berechtigungen
| Rolle | Zugriff | Aktionen |
| --- | --- | --- |
| BATE | Vollzugriff | Orders anlegen, Status, Freigaben, Uploads, Kalender |
| Lieferant | Eingeschränkt | Orders sehen, Rückfragen/Uploads, Statusfortschritt |
| System | Automatisiert | Sync, Benachrichtigungen, Logs |
| (Future) Kunde | Read-only | Eigene Aufträge einsehen |

## 7. Datei- & Medienhandling
- Unterstützt: JPG, PNG, WEBP, PDF, DOCX, XLS, MP4, MOV, AI/PSD/ZIP.
- Ordnerstruktur: `/uploads/orders/{order_id}/order-level` & `/positions/{position_id}`.
- Versionierung mit sicherem Dateinamen, Timestamp, Uploader-ID.

## 8. Benachrichtigungssystem
- Phase 1: Portal-Bell, Ereignisse (Rückfrage, Kommentar, Freigabe, Status), markierbar als gelesen.
- Phase 2+: SMTP-Mail & Browser-Push.

## 9. Kalender
- Auto-Events: Produktionsstart, Versand, Abholung (aus ERP-Daten).
- Ansicht: Monat/Woche, filterbar nach Bestellung/Lieferant/Status.
- Manuelle Events (z. B. „Freigabe KW47“), alle Änderungen geloggt.

## 10. UX-Prinzipien
- Kartenbasiertes Layout, Ampel-Status, Timeline pro Order, Tabs (Übersicht/Positionen/Kommunikation/Dateien), Chat-ähnliche Kommentare.
- Dashboard-Widgets: offene Rückfragen, fällige Freigaben, letzter Sync, Produktionsstatus.

## 11. Architekturübersicht
```
ERPNext → REST API (Axios Token)
        ↓
Node/Express Backend → JSON Persistenz, Multer Uploads, Cron Sync, REST APIs
        ↓
Statisches Frontend (HTML/CSS/JS) mit i18n-Stub, Role-based Access
```
Persistenz (`backend/data`): `customers`, `orders`, `spec_sheets`, `tickets`, `calendar`, `notifications`, `status_logs`, `last_sync`.

## 12. Best Practices
| Unternehmen | System | Learning |
| --- | --- | --- |
| Adidas | Supplier Portal | Spezifikationskarten + Anhänge pro Bestellung |
| Inditex | Supplier Mgmt | Kommunikation je Artikel, Freigaben integriert |
| Nike | Maker Portal | Medien & Freigaben in einem Thread, Statusampel |

## 13. Zukunftsphasen
| Phase | Erweiterung | Ziel |
| --- | --- | --- |
| 1 | Portal + ERP-Sync + Workflow | Transparenz intern |
| 2 | E-Mail, Türkisch, Rechte | Automatisierung & Intl |
| 3 | Kundenportal, Analytics | Reporting & Transparenz extern |
| 4 | Mobile App/PWA | Nutzung unterwegs |

## 14. Ergebnis
- Zentrale, strukturierte Plattform als ERP-Ergänzung.
- Alle Rückfragen, Dateien & Spezifikationen gebündelt.
- Transparentes Statussystem über den Zyklus.
- Weniger E-Mails, keine Informationsverluste.
- Grundlage für Mehrsprachigkeit & mobile Nutzung.
