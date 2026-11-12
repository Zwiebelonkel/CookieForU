# A cookie for you — Render + Turso

Ein kleiner TypeScript-Webservice (`src/server.ts`) mit Express, Turso-libSQL,
HTML-Frontend und druckbaren Zertifikaten. Kein Sites-Projekt.

## Was enthalten ist

- Kryptografisch zufällige 64-stellige IDs, ausschließlich vom Server erzeugt.
- Maximal 10 neue Kekse pro Browser-Session innerhalb der letzten 10 Minuten.
  Die Session wird tabübergreifend im Browser gespeichert; der Server zählt neue
  Ausgaben dauerhaft und atomar in der Datenbank. Neuladen und Server-Neustarts
  setzen das Limit nicht zurück. Wiederholungen mit demselben Owner-Token zählen
  nicht erneut. Beim Limit erscheint 🍫 „Cookies are getting baked.“ mit Countdown;
  danach wird automatisch erneut ein Keks angefordert.
- Unverändertes Original und Raritätsregel v1 dauerhaft in Turso.
- Kaffeebraune Website mit pulsierendem, langsam rotierendem Cookie.
- Animiertes Info-Menü oben links mit Raritätschancen, Sternen und farbigen
  Prozentbalken. Die Werte kommen direkt aus den Raritätsregeln des Servers.
- Raritätsabhängige Kontur und Leuchten am Cookie, auch an Bisskanten.
  Seltenere Cookies schweben und pulsieren stärker und drehen sich schneller
  (60 Sekunden pro Umdrehung bei Common bis 9 Sekunden bei Mythic).
  Passende Sterne unter der Rarität: Common 1, Uncommon 2, Rare 3, Epic 4,
  Legendary 5, Mythic 6. Reduzierte Bewegung schaltet die Animationen aus.
- Hervorgehobene Zeichenserien, Rarität, Apple-Touch-Icon.
- Drei Bisse: angezeigter Hash wird 64 → 42 → 21 → 0 Zeichen lang.
- Öffentliche Teilen-Links; Essen nur mit separatem Besitzer-Token.
- Gleichzeitige/doppelte Biss-Anfragen ändern den Stand nur einmal pro
  erwarteter Bissnummer. Netzwerkfehler lösen keinen automatischen weiteren Biss aus.
- Öffentliche Prüfseite mit offiziellen Daten.
- Zertifikate mit QR-Code und „Print / Save as PDF“ nur mit dem passenden
  Besitzer-Token. Bei geteilten Cookies ist „Certificate“ ausgeblendet.
- Privater Owner-Pass als JSON-Download; auf einem anderen Browser wiederherstellbar.
  Beim Klick auf „Certificate“ wird er sofort separat heruntergeladen; der geheime
  Owner-Key steht weder im Zertifikat noch im PDF.
- Jedes neu erstellte Zertifikat erhält eine eigene Certificate ID (UUID).
  Jeder Owner-Pass-Export erhält eine eigene `ownerPassId` (UUID), auch im
  Dateinamen. Beide enthalten zusätzlich die ursprüngliche Cookie-ID;
  bestehende Owner-Pass-Dateien bleiben importierbar.
- Besitzprüfung ohne Konto: Ein eigener Prüfcode pro Prüfer, fünf Minuten gültig,
  einmal vom Owner bestätigbar. Das Ergebnis erscheint auf dem Gerät des Prüfers.
- Wiederholte Erstellungsanfragen mit demselben Besitzer-Token liefern denselben
  Cookie, statt bei einer verlorenen Antwort einen weiteren auszugeben.

## 1. Dateien ins GitHub-Repository

Den **Inhalt dieses Ordners** ins Repository-Hauptverzeichnis kopieren:

```text
src/server.ts
src/app.ts
src/cookies.ts
src/owner-checks.ts
src/pages.ts
public/index.html
public/app.js
public/ownership.js
public/session.js
public/info-menu.js
public/style.css
public/apple-touch-icon.png
public/certificate.css
public/certificate.js
schema.sql
package.json
package-lock.json
tsconfig.json
render.yaml
```

README, `.gitignore`, `.nvmrc`, `.env.example` und `test/` ebenfalls mitnehmen.
`node_modules/`, echte `.env`-Dateien und lokale Datenbanken nicht hochladen.
Das zuletzt generierte App-Icon ist in `public/apple-touch-icon.png` enthalten.
Du kannst diese Datei durch deine eigene gleichnamige PNG ersetzen.

## 2. Turso-Datenbank anlegen

Eine **Turso Cloud libSQL-Datenbank** anlegen. Diese Implementierung nutzt
`@libsql/client` und eine URL im Format `libsql://…turso.io`.
Turso ist hier SQLite/libSQL, nicht PostgreSQL. Der neuere Turso-Engine-Treiber
ist ein separates Angebot und wird von diesem Projekt nicht vorausgesetzt.

In Turso die Datenbank-URL und ein Datenbank-Token mit Schreibzugriff holen.
Mit bereits installierter, angemeldeter Turso-CLI beispielsweise:

```bash
turso db create cookie-registry
turso db show cookie-registry --url
turso db tokens create cookie-registry
```

Das Token ausschließlich in Render als geheime Umgebungsvariable eintragen.
Es gehört niemals in HTML, öffentliche JavaScript-Dateien oder GitHub.
`schema.sql` wird beim Serverstart mit `CREATE TABLE IF NOT EXISTS` ausgeführt;
die Tabelle muss nicht manuell angelegt werden. Für ein bestehendes anderes
Schema bitte eine separate Datenbank verwenden.

## 3. In Render deployen

### Variante A: New → Web Service

GitHub-Repository verbinden und folgende Werte setzen:

| Feld | Wert |
| --- | --- |
| Runtime / Language | Node |
| Root Directory | Leer, wenn package.json im Repository-Hauptverzeichnis liegt |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/health` |

Umgebungsvariablen:

| Variable | Wert |
| --- | --- |
| `NODE_VERSION` | `24` |
| `NODE_ENV` | `production` |
| `TURSO_DATABASE_URL` | Deine `libsql://…`-URL |
| `TURSO_AUTH_TOKEN` | Dein privates Datenbank-Token |

Der Server bindet an `0.0.0.0` und verwendet Renders `PORT`.
Render stellt `RENDER_EXTERNAL_URL` bereit. Daraus entstehen die öffentlichen
Teilen-, Prüf- und Zertifikatslinks automatisch.

### Variante B: New → Blueprint

Repository verbinden und die enthaltene `render.yaml` verwenden. Turso-URL und
Token eintragen. Die Blueprint-Vorlage verwendet einen Free-Webservice.
Prüfe die im Dashboard angezeigte Instanz vor dem Anlegen.

### Eigene Domain

Wenn du eine eigene Domain in Render verwendest, zusätzlich setzen:

```text
PUBLIC_BASE_URL=https://deine-cookie-domain.de
```

Nur die Origin ohne Pfad oder Query eintragen. Die Prüf-Domain sollte langfristig
unter deiner Kontrolle bleiben, damit gedruckte QR-Codes weiter funktionieren.
Der Server vertraut für Zertifikatslinks nicht auf einen vom Besucher gesendeten
Host-Header.

## 4. Nach dem Deployment prüfen

Die neue Render-Adresse direkt öffnen. Render liefert sowohl Website als auch API.
Ohne `?cookie=` erhält jeder neue Seitenaufruf einen neuen Cookie.

1. `/health` muss `{"ok":true}` zurückgeben.
2. Auf der Startseite muss ein Cookie mit ID erscheinen.
3. Teilen-Link in einem privaten Fenster öffnen: identische ID, Essen deaktiviert,
   „Certificate“ ausgeblendet. Die Zertifikats-API verweigert den Zugriff ohne
   passendes Besitzer-Token.
4. Im ursprünglichen Browser drei Bisse nehmen. Derselbe Teilen-Link muss danach
   den aufgegessenen Cookie zeigen. Ein offenes fremdes Fenster aktualisiert sich
   im sichtbaren Zustand spätestens beim nächsten erfolgreichen 15-Sekunden-Poll.
5. Im ursprünglichen Browser „Certificate“ öffnen, den QR-Code scannen und
   „Print / Save as PDF“ verwenden. Die öffentliche Prüfseite zeigt nur den
   Registereintrag und bietet keine Zertifikats-Druckfunktion.
6. Eine erfundene 64-stellige ID über `/verify/…` aufrufen: „Cookie not found“.
7. Beim Owner „Save Owner Pass“ wählen und die private JSON-Datei sicher aufbewahren.
   In einem anderen Browser „Restore Owner Pass“ wählen und diese Datei importieren:
   Derselbe Cookie ist wieder steuerbar, auch wenn er bereits aufgegessen ist.
8. Auf der öffentlichen Prüfseite im privaten Fenster „Verify owner“ wählen. Den
   Code im Owner-Browser unter „Confirm ownership“ bestätigen. Nur die zugehörige
   Prüfseite zeigt die aktuelle Bestätigung; eine zweite neue Prüfung bleibt offen.
   Nach fünf Minuten erlischt die Bestätigung. Ohne Verbindung wird kein grüner
   Bestätigungsstatus weiter angezeigt, sobald die nächste Abfrage fehlschlägt.

Für das T-Shirt den QR-Code auf die Startseite ohne Cookie-ID richten.
Für ein Zertifikat verwendet der Server dagegen `/verify/<id>`.

**Free-Instanz:** Render fährt kostenlose Webservices nach Inaktivität herunter;
beim ersten Aufruf kann das Wiederanlaufen ungefähr eine Minute dauern. Für einen
spontanen T-Shirt-Scan ist diese Wartezeit relevant. Turso hält die Daten weiterhin
dauerhaft; es wird in Produktion keine lokale Render-SQLite-Datei verwendet.

## Optional: bestehende HTML-Seite auf GitHub Pages behalten

Die Dateien aus `public/` nach GitHub Pages kopieren. In `index.html` setzen:

```html
<meta name="cookie-api" content="https://DEIN-SERVICE.onrender.com">
```

In Render zusätzlich:

```text
CORS_ORIGIN=https://DEIN-USERNAME.github.io
```

`CORS_ORIGIN` enthält nur die Origin, keinen Repository-Pfad und keinen
abschließenden Slash. API und Zertifikate bleiben auf Render. Geteilte Links
zeigen standardmäßig auf die kanonische Render-/PUBLIC_BASE_URL-Adresse.
Für die einfachste Einrichtung die komplette Website direkt auf Render nutzen.

## Lokales Entwickeln

Node.js 24 installieren. Dann:

```bash
npm ci
cp .env.example .env
npm run dev
```

`http://localhost:3000` öffnen. Ohne Turso-Zugang nutzt diese Konfiguration die
lokale Datei `cookie-dev.db`. Für den produktiven Betrieb verlangt der Server eine
remote Turso-URL und ein Token.

```bash
npm run build
npm test
```

Die Tests verwenden eine echte lokale libSQL-Datenbank. Sie prüfen unter anderem
Server-Ausgabe, gefälschte IDs, Besitzerschutz, konkurrierende Bisse, den dauerhaften
Eaten-Zustand, Zertifikatsdaten, öffentliche Links und CORS. Eine echte Turso-
Remote-Verbindung und ein Render-Deployment benötigen deine Kontoeinstellungen.
Die Tests für den Prüfstatus führen das Frontend-Skript mit einer simulierten DOM-
und Timer-Umgebung aus; sie ersetzen keine visuelle Prüfung im echten Browser.

## API

### Neuen Cookie ausstellen

Zuerst mit `POST /api/session` und leerem JSON-Body `{}` eine anonyme Session
anlegen. Die Antwort enthält `sessionToken` (64 Hexzeichen). Das Frontend speichert
es im Local Storage unter `cookie-session:<API-Origin>` und verwendet es über
Neuladen und mehrere Tabs hinweg. Web Locks verhindern bei gleichzeitig geöffneten
Tabs die mehrfache Erstanlage. Bei deaktiviertem Browserspeicher gilt die Session
nur im aktuellen Tab. Ohne Nutzerkonto bezieht sich das Limit auf dieses
Browserprofil; ein anderer Browser oder gelöschter Browserspeicher hat eine neue
Session.

```http
POST /api/cookies
Content-Type: application/json
X-Cookie-Session: <sessionToken>

{"ownerToken":"64-kryptografisch-zufällige-kleine-Hexzeichen"}
```

Der Browser erzeugt nur das geheime Besitzer-Token. ID und Rarität kommen vom Server.
Das echte Token muss genau `[0-9a-f]{64}` entsprechen. Andere Body-Felder werden
abgelehnt. Status 201 bei neuer Ausgabe, 200 bei Wiederholung mit demselben Token.
Antwort: `{"cookie": {"id":"…", "rarity":"…", "bites":0, …}}`.
Ohne gültige Session: 401 mit `code: "session_required"`. Bei 10 neuen Ausgaben
innerhalb der letzten 10 Minuten: 429 mit `code: "quota_exhausted"`,
`retryAfterMs` und `Retry-After` (Sekunden). Sobald der älteste Keks aus dem
Zeitfenster fällt, ist wieder Platz für einen neuen. Abrufen, Essen, Zertifikate
und Owner-Pass-Wiederherstellung verbrauchen kein Kontingent.

### Abrufen / validieren

```http
GET /api/cookies/<id>
GET /verify/<id>
```

Unbekannte IDs erhalten 404. Ein aufgegessener Cookie bleibt als echter,
bereits gegessener Cookie abrufbar. Die Original-ID wird nicht gelöscht oder gekürzt.

### Zertifikat erstellen (nur Besitzer)

```http
GET /api/cookies/<id>/certificate
Authorization: Bearer <ownerToken>
```

Ein fehlendes oder ungültig formatiertes Token führt zu 401, ein fremdes Token zu
403. Die Prüfung erfolgt serverseitig. Das Frontend lädt das Zertifikat mit diesem
Header und zeigt es in einem neuen Tab an; das Token steht nie in der URL oder im
Zertifikat. Auch für aufgegessene Cookies kann der Besitzer ein Zertifikat erstellen.
Die öffentliche Prüfseite erstellt kein Zertifikat und bietet keine Druckfunktion.

### Owner-Pass prüfen / wiederherstellen

```http
GET /api/cookies/<id>/owner
Authorization: Bearer <ownerToken>
```

Liefert den Cookie nur bei passendem Schlüssel zurück. Erst danach speichert das
Frontend einen importierten Owner-Pass lokal. Der Import erstellt keinen neuen
Cookie und verändert keine Bisse. Das JSON enthält Dienst-Origin, Cookie-ID und
den geheimen Owner-Token. Der Browser sendet ihn ausschließlich an seine bereits
konfigurierte API; eine abweichende Origin im Pass wird abgelehnt. Bei gesperrtem
Browser-Speicher bleibt der Besitz nur im aktuellen Tab erhalten.

### Besitzprüfung starten, lesen und bestätigen

```http
POST /api/cookies/<id>/owner-checks
Content-Type: application/json

{}
```

Öffentlich, mit eigenem Rate-Limit von zehn Starts pro Minute und IP/Instanz.
Antwort: `{"check":{"code":"16-Hexzeichen","cookieId":"…","status":"pending",
"expiresAt":"…","remainingMs":300000,"confirmedAt":null},"verifierToken":"…"}`.
Code und Lese-Token werden zufällig vom Server erzeugt. Nur der Code wird dem
Owner gezeigt; das Lese-Token bleibt im Arbeitsspeicher des Prüfer-Tabs.

```http
GET /api/cookies/<id>/owner-checks/<code>
Authorization: Bearer <verifierToken>

POST /api/cookies/<id>/owner-checks/<code>/confirm
Authorization: Bearer <ownerToken>
Content-Type: application/json

{}
```

Der Owner bestätigt ausdrücklich den Code von der Seite des Prüfers. Bestätigung
und Ablaufprüfung erfolgen atomar in Turso. Ein Code gilt nur für seinen Cookie
und ist einmal bestätigbar (409 bei Wiederholung, 410 bei Ablauf). Die Prüfseite
fragt ihren eigenen Status alle zwei Sekunden ab und entfernt den grünen Status
bei Ablauf oder Abfragefehlern. Eine Bestätigung ist kein globales Besitzsiegel:
Andere Prüfungen bleiben offen. Erneutes Laden beginnt ohne Bestätigung.

`owner_checks` wird beim Start automatisch ergänzend angelegt; bestehende Cookies
bleiben erhalten. Der Server speichert Lese-Tokens nur gehasht. Abgelaufene
Prüfungen werden nach einem weiteren Tag beim Start neuer Prüfungen aufgeräumt.

### Einen Bissen nehmen

```http
POST /api/cookies/<id>/bite
Authorization: Bearer <ownerToken>
Content-Type: application/json

{"expectedBites":0}
```

`expectedBites` ist 0, 1 oder 2. Ein veralteter Stand oder falsches Token führt zu
409, ein fehlendes Token zu 401. Die bedingte SQL-Aktualisierung ist atomar und
übernimmt keine vom Browser frei vorgegebene Bissanzahl.

## Was „verifiziert“ bedeutet

Die offizielle HTTPS-Prüfseite bestätigt, dass der Dienst die ID ausgegeben hat,
und zeigt ihre gespeicherte Rarität sowie den aktuellen Zustand. Das PDF selbst
ist ein kopierbarer, bearbeitbarer Ausdruck und keine kryptografisch signierte PDF.
Prüfe Domain und Online-Daten beim Scannen. Es wird kein exklusiver Besitz
bescheinigt. Ein gegessener Cookie hat weiterhin einen historischen Ausgabebeleg.

Die zusätzliche aktuelle Besitzprüfung bestätigt die Kontrolle über den geheimen
Owner-Schlüssel, nicht die Identität einer realen Person. Ein kopiertes öffentliches
Zertifikat kann keinen neuen Prüfcode beantworten. Der private Owner-Pass ist
dagegen ein Zugangsschlüssel: Wer ihn kopiert, erhält dieselben Befugnisse. Er
gehört niemals auf das öffentliche Zertifikat oder in die Hände eines Prüfers.

Vorher nur im Browser erzeugte Cookies sind nicht im neuen Register und bekommen
keine nachträgliche Echtheitsbestätigung. Aus dem Browser gelöschte Besitzer-Tokens
lassen sich ohne weiteres Kontosystem nicht wiederherstellen. Öffentliche Links
geben diese Tokens niemals weiter.

Die Ausgabe ist wiederholbar: Besucher können mehrere Cookies sammeln. Die
Raritätswahrscheinlichkeiten gelten pro Ausgabe, nicht pro Person. Das einfache
Rate-Limit gilt pro laufender Instanz und ersetzt bei größerem Betrieb keinen
zentralen Missbrauchsschutz.

## Quellen zur Einrichtung

- https://render.com/docs/deploy-node-express-app
- https://render.com/docs/web-services
- https://render.com/docs/blueprint-spec
- https://render.com/docs/free
- https://docs.turso.tech/sdk/ts/quickstart
- https://docs.turso.tech/sdk/ts/reference
- https://docs.turso.tech/cli/db/tokens/create
