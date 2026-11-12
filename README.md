# A cookie for you — Render + Turso

Ein kleiner TypeScript-Webservice (`src/server.ts`) mit Express, Turso-libSQL,
HTML-Frontend und druckbaren Zertifikaten. Kein Sites-Projekt.

## Was enthalten ist

- Kryptografisch zufällige 64-stellige IDs, ausschließlich vom Server erzeugt.
- Unverändertes Original und Raritätsregel v1 dauerhaft in Turso.
- Kaffeebraune Website mit pulsierendem, langsam rotierendem Cookie.
- Hervorgehobene Zeichenserien, Rarität, Apple-Touch-Icon.
- Drei Bisse: angezeigter Hash wird 64 → 42 → 21 → 0 Zeichen lang.
- Öffentliche Teilen-Links; Essen nur mit separatem Besitzer-Token.
- Gleichzeitige/doppelte Biss-Anfragen ändern den Stand nur einmal pro
  erwarteter Bissnummer. Netzwerkfehler lösen keinen automatischen weiteren Biss aus.
- Öffentliche Prüfseite mit offiziellen Daten und QR-Code.
- Zertifikatsansicht mit „Print / Save as PDF“ (Browser-Druckdialog).
- Wiederholte Erstellungsanfragen mit demselben Besitzer-Token liefern denselben
  Cookie, statt bei einer verlorenen Antwort einen weiteren auszugeben.

## 1. Dateien ins GitHub-Repository

Den **Inhalt dieses Ordners** ins Repository-Hauptverzeichnis kopieren:

```text
src/server.ts
src/app.ts
src/cookies.ts
src/pages.ts
public/index.html
public/app.js
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
3. Teilen-Link in einem privaten Fenster öffnen: identische ID, Essen deaktiviert.
4. Im ursprünglichen Browser drei Bisse nehmen. Derselbe Teilen-Link muss danach
   den aufgegessenen Cookie zeigen. Ein offenes fremdes Fenster aktualisiert sich
   im sichtbaren Zustand spätestens beim nächsten erfolgreichen 15-Sekunden-Poll.
5. „Certificate“ öffnen, den QR-Code scannen und „Print / Save as PDF“ verwenden.
6. Eine erfundene 64-stellige ID über `/verify/…` aufrufen: „Cookie not found“.

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

## API

### Neuen Cookie ausstellen

```http
POST /api/cookies
Content-Type: application/json

{"ownerToken":"64-kryptografisch-zufällige-kleine-Hexzeichen"}
```

Der Browser erzeugt nur das geheime Besitzer-Token. ID und Rarität kommen vom Server.
Das echte Token muss genau `[0-9a-f]{64}` entsprechen. Andere Body-Felder werden
abgelehnt. Status 201 bei neuer Ausgabe, 200 bei Wiederholung mit demselben Token.
Antwort: `{"cookie": {"id":"…", "rarity":"…", "bites":0, …}}`.

### Abrufen / validieren

```http
GET /api/cookies/<id>
GET /verify/<id>
GET /api/cookies/<id>/certificate
```

Unbekannte IDs erhalten 404. Ein aufgegessener Cookie bleibt als echter,
bereits gegessener Cookie abrufbar. Die Original-ID wird nicht gelöscht oder gekürzt.

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
