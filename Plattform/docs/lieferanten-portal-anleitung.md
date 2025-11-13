# Lieferanten-Portal – Master Guide 2024

> **Mission:** Lieferanten in < 30 Minuten onboarding-fähig machen. Jeder Abschnitt erklärt klar, _warum_ ein Module existiert, _was_ dort sichtbar ist und _welche Aktion_ erwartet wird. Screenshots werden später ergänzt – die Platzhalter geben Motiv, Auflösung und Fokus vor.

---

## Quick Facts

| Thema | Details |
| --- | --- |
| Portalrollen | Lieferant (Produktion), BATE (HQ) |
| Pflichtgeräte | Desktop/Laptop (optimiert für 1440 px Breite), aktueller Chrome/Edge |
| Sprachen | Deutsch (aktuell), Türkisch/Englisch vorbereitet |
| Sync-Frequenz | ERP-Sync alle 10 Minuten + manueller Trigger |
| Supportweg | Ticket „Systemstatus“ oder direkter Ansprechpartner |

---

## Navigationskarte

1. [Zugang & Setup](#01-zugang--setup)  
2. [Dashboard Radar](#02-dashboard-radar)  
3. [Bestellungen & Statusführung](#03-bestellungen--statusfuehrung)  
4. [Artikelpositionen & Tech Packs](#04-artikelpositionen--tech-packs)  
5. [Kommunikation & Tickets](#05-kommunikation--tickets)  
6. [Packaging Hub (Kartons & Shoebox)](#06-packaging-hub-kartons--shoebox)  
7. [Seitenmodule & Monitoring](#07-seitenmodule--monitoring)  
8. [Daily Playbook & Best Practices](#08-daily-playbook--best-practices)  
9. [Screenshot-Checkliste](#screenshot-checkliste)

---

## 01 Zugang & Setup

**Ziel:** Sicherer Start – Account aktivieren, Basisinfos prüfen.

| Schritt | Aktion |
| --- | --- |
| Zugangsdaten | E-Mail + Initialpasswort vom BATE-Team erhalten |
| Login | Portal-URL öffnen → Anmelden → ggf. 2FA bestätigen |
| Passwort ändern | `Profil → Sicherheit` direkt nach dem ersten Login |
| Health-Check | Benachrichtigungen aktiv, Browser auf Deutsch, Pop-up-Blocker für Portal deaktivieren |
| Support | Account-Probleme als Ticket im Bereich **Systemstatus** melden |

**Screenshot einfügen:** `images/placeholders/login.png` – Login mit Branding, 1200×800 px, Fokus auf Formular + Logo.

---

## 02 Dashboard Radar

**Warum wichtig?** Das Dashboard bündelt alle offenen Aktionen. Ein Blick reicht, um Prioritäten zu erkennen.

![Dashboard Platzhalter](images/placeholders/dashboard.png)  
_Ersetzen durch KPI-Ansicht + Tabellen, 1600×900 px._

| Widget | Bedeutung | Aktion |
| --- | --- | --- |
| Neue Bestellungen | ERP-Sync zeigt frische Orders | „Mehr“ → Bestellliste öffnen & Status prüfen |
| Offene Tickets · Bestellungen | Rückfragen auf Order-Level | Verantwortliche Person zuweisen, Status aktualisieren |
| Offene Tickets · Techpacks | Artikelbezogene Threads | Direkt in Artikelspezifikation antworten |
| Tabelle „Neue Bestellungen“ | Kompakte Liste inkl. Status, Kunde, Liefertermin | Klick auf Ordernummer öffnet Detailseite |
| Ticket-Listen unten | Alle offenen Tickets (Bestellung/Techpack) | Button „Alle“ führt zur Ticketübersicht (Filter setzen) |

> ⚡ **Routine:** Morgens Dashboard aufrufen → Tickets mit SLA < 24 h markieren → Status ggf. auf „Rückfragen offen“ setzen.

---

## 03 Bestellungen & Statusführung

### 3.1 Listenansicht (`Bestellungen`)

- **Filter**: Status, Kunde, Bestellnummer, Freitext.  
- **Sortierung**: Standard = Neueste Order oben.  
- **Anlegen-Button**: Nur für BATE sichtbar (Lieferanten lesen/bearbeiten bestehende Orders).

### 3.2 Detailansicht einer Bestellung

![Order-Platzhalter](images/placeholders/order-detail.png)  
_Zeige Kopf (Status, Tickets), Stammdaten, Positionsliste. 1600×900 px._

| Block | Inhalt | Hinweise |
| --- | --- | --- |
| Header | Bestellnummer, Bestellart (SMS → PPS → Serienorder), Liefertermin, Gesamtmenge, Ticketzähler | Statuswechsel direkt hier |
| Stammdaten | Absender (Produktion), Kunde, Lieferadresse, Kundennummer, Ansprechpartner, Kontakte | Änderungen laufen über BATE |
| Versand | Versandzahler, Transportart, Abholung, Incoterms | Basis für Logistikplanung |
| Aktionen | `PDF anzeigen` (Order, Kartons, Shoebox) | Ausdruck dient als Shopfloor-Referenz |
| Positionsliste | Artikelnummer, Typ, Farbcode, Größen, Menge, Preise, Vorschaubild | Link `Artikelspezifikation` → Tech Pack |

#### Statusmodell (muss eingehalten werden)

| Reihenfolge | Status | Auslöser | Verantwortlich |
| --- | --- | --- | --- |
| 1 | Neu eingereicht | Order aus ERP importiert | System |
| 2 | Bestätigt | Lieferant hat Order geprüft | Lieferant |
| 3 | Rückfragen offen | Ticket erstellt / offene Frage | Lieferant |
| 4 | Rückfragen geklärt | Antwort erhalten, Klarheit hergestellt | BATE |
| 5 | Produktion läuft | Fertigung gestartet | Lieferant |
| 6 | Versandbereit | Ware fertig, Abholung möglich | Lieferant |
| 7 | Abgeschlossen | Übergabe/Versand erfolgt | BATE |

> ✅ **Regel:** Status spätestens innerhalb von 24 h aktualisieren, damit Timeline & Notifications korrekt bleiben.

---

## 04 Artikelpositionen & Tech Packs

### 4.1 Positionsliste verstehen

- Jede Zeile = eine Artikelposition mit eigenem Tech Pack.
- Spalten: Artikelnummer, Schuhtyp, Farbcode, Größenraster, Menge, Einzel-/Gesamtpreis.
- Klick auf `Artikelspezifikation` öffnet die 360°-Ansicht.

### 4.2 Tech Pack Aufbau

![Tech-Pack Platzhalter](images/placeholders/techpack.png)  
_Fokus auf Ansichten mit Markierungen + Ticketbereich, 1400×900 px._

| Abschnitt | Inhalt | Aktion |
| --- | --- | --- |
| Kopf | Position #, Artikelnummer, Typ, Farbcode, Menge, Status (Offen/OK) | Nach finaler Prüfung auf „Okay“ setzen |
| Ansichten | Seiten-, Vorder-, Innen-, Rückansicht, Sohle etc. inkl. nummerierter Markierungen | Jede Markierung lesen, ggf. kommentieren |
| Anweisungen | Liste aller Punkte inkl. Beschreibung/Wunsch | Änderungswünsche nachvollziehen |
| Zubehör | Schuhbox, Seidenpapier, Stoffbeutel + PDFs | Herunterladen & umsetzen |
| Tickets | Thread nur für diese Position | Rückfragen stellen, Screenshots anhängen |

**Workflow:**  
1. Alle Ansichten expandieren → Markierungen lesen.  
2. Rückfrage? Ticket im Tech Pack erstellen.  
3. Antwort erhalten → ggf. nachfassen.  
4. Klar? Status auf `Okay`, zurück zur Positionsliste.

---

## 05 Kommunikation & Tickets

![Ticket-Platzhalter](images/placeholders/tickets.png)  
_Liste mit Filtern + Statuschips, 1400×850 px._

### Ticket-Arten

| Typ | Ort | Einsatz | Beispiel |
| --- | --- | --- | --- |
| Bestell-Ticket | Unterhalb einer Bestellung | Allgemeine Fragen (Timeline, Mengen, Verpackung) | „Liefertermin um 1 Woche verschieben?“ |
| Tech-Pack-Ticket | In der Artikelspezifikation | Artikel-/Ansicht-spezifische Details | „Logo an Position 3: Farbe HEX #000?“ |

### Kommunikationsregeln

1. **Titel klar formulieren:** `Rückfrage Karton 38-41` > `Frage`.  
2. **Belege anhängen:** Screenshot, Dateiname oder Referenzschritt nennen.  
3. **Status schließen:** Sobald geklärt, Ticket schließen → Dashboard-Zähler sinkt.  
4. **Dringendes Thema:** Zusätzlich Orderstatus auf „Rückfragen offen“ setzen.  
5. **Keine Schattenkanäle:** WhatsApp/Telefon nur für Eskalationen; Infos immer im Portal protokollieren.

---

## 06 Packaging Hub (Kartons & Shoebox)

![Packaging-Platzhalter](images/placeholders/packaging.png)  
_Tabs + Formularfelder zeigen, 1400×800 px._

### Kartons

- Kunde-spezifische Layouts werden vom BATE-Team eingerichtet.
- Du pflegst Variation/Artikelnummer, Farbcode, Materialien, Reihenfolge (z. B. 36–45) und Mengen.
- „Neuer Karton“ = weiteres Set.  
- `Drucken` erzeugt PDF zur direkten Übergabe in der Fertigung.

### Shoebox

- Etiketten, Kartonlayouts, ggf. Label-Sticker.
- Menge automatisch aus Bestellung, trotzdem validieren.
- Vor Versand: Druck auslösen und Etiketten am Band verwenden.

---

## 07 Seitenmodule & Monitoring

![Side-Module Platzhalter](images/placeholders/processstatus.png)  
_Prozessstatus-Timeline oder Collage aus Modulen, 1600×900 px._

| Modul | Nutzen | Key Actions |
| --- | --- | --- |
| Artikel | Artikel nach Nummer/Farbcode finden | Spezifikationen & Bilder nachschlagen |
| Kunden | Stammdaten + Packaging-Vorgaben | Rechnungs-/Lieferadressen prüfen |
| Tickets | Globale Ticketliste | Filter nach Verantwortlichem/Status setzen |
| Prozessstatus | Timeline aller aktiven Orders | Deadlines im Blick behalten, Engpässe melden |

> 🛰️ **Monitoring-Tipp:** Prozessstatus wöchentlich exportieren und mit eigenen Produktionsplänen abgleichen.

---

## 08 Daily Playbook & Best Practices

### Tagesablauf (Empfehlung)

1. **08:00** – Dashboard öffnen, neue Tickets markieren.  
2. **08:15** – Bestellungen mit Status `Neu eingereicht` → `Bestätigt`.  
3. **09:00** – Tech Packs des Tages durchgehen, Rückfragen direkt dort stellen.  
4. **Nachmittag** – Packaging-Tabs prüfen, Druckdateien erzeugen, Versandstatus aktualisieren.  
5. **Feierabend** – Ticketliste checken, offene Punkte mit ETA versehen.

### Dos & Don’ts

| ✅ Tun | ❌ Lassen |
| --- | --- |
| Status unmittelbar anpassen | Status erst Tage später ändern |
| Tickets sauber trennen (Order vs. Tech Pack) | Sammel-Ticket für mehrere Artikel |
| Markierungen im Tech Pack vollständig lesen | Nur Vorschaubild ansehen |
| PDFs (Order/Kartons/Shoebox) als „Single Source of Truth“ nutzen | Eigene Offline-Versionen pflegen |
| Dashboard-FIlter + Suche nutzen | Listen manuell durchsuchen |

---

## Screenshot-Checkliste

| Datei | Motiv | Auflösung | Hinweise |
| --- | --- | --- | --- |
| `images/placeholders/login.png` | Login-Screen mit Branding | 1200×800 px | Logo, Eingabefelder, „Passwort vergessen“ sichtbar |
| `images/placeholders/dashboard.png` | Dashboard mit KPI-Karten & Tabellen | 1600×900 px | Alle Widgets gefüllt, keine Dummy-Daten |
| `images/placeholders/order-detail.png` | Bestell-Detailseite | 1600×900 px | Status-Dropdown, Tickets, Positionen |
| `images/placeholders/techpack.png` | Tech-Pack-Ansicht | 1400×900 px | Markierungen + Ticketbereich |
| `images/placeholders/tickets.png` | Ticketliste | 1400×850 px | Filter oben, Statuschips unten |
| `images/placeholders/packaging.png` | Kartons/Shoebox Tabs | 1400×800 px | Beide Reiter + Formularfelder |
| `images/placeholders/processstatus.png` | Prozessstatus oder Seitenmodul-Collage | 1600×900 px | Timeline + Statusbalken |

---

Mit diesem Guide hast du eine saubere, modulare Anleitung für das komplette Portal. Ergänze nur noch deine finalen Screenshots, und jede neue Lieferanten-Crew kann sofort produktiv loslegen. Bei Fragen: Ticket erstellen oder direkt beim BATE-Ansprechpartner melden. Viel Erfolg! 🚀
