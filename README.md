# Simple SMTP Test

Ein schlankes Werkzeug zum Prüfen von SMTP-Servern. Orange und Graphit, mit
Hell-, Dark- und Systemmodus. Für den eigenen Server oder das interne Netzwerk.

## Funktionen

- Verbindung und optionale Benutzername/Passwort-Anmeldung prüfen
- Test-Mail als Text oder HTML senden
- STARTTLS, direktes TLS und unverschlüsseltes SMTP
- Anbietervorlagen, Timeout und TLS-Hostname konfigurieren
- Live-Protokoll, Serverantwort und JSON-Ergebnisexport
- Responsive Oberfläche ohne Tracking oder externe Schriftarten

Eine erfolgreiche Test-Mail bedeutet, dass der SMTP-Server sie angenommen hat.
Sie bestätigt keine Zustellung in den Posteingang. Ein Verbindungstest versendet
keine Nachricht. STARTTLS wird erzwungen; die App fällt dabei nicht auf eine
unverschlüsselte Verbindung zurück.

## Docker Compose

```bash
docker compose up -d --build
```

Die App ist unter `http://<docker-host>:3008` erreichbar. Ein anderer Host-Port
kann in `.env` gesetzt werden:

```env
SMTP_TEST_PORT=3010
```

```bash
docker compose logs -f simple-smtp-test
docker compose down
```

Der Container läuft als Benutzer `node`. Es werden keine Datenbank und keine
Volumes benötigt. Der Healthcheck fragt `/api/health` ab und sendet keine Mail.
SMTP-Verbindungen erfolgen vom Container aus; Zielserver, DNS und SMTP-Port
müssen von dort erreichbar sein. Der Build benötigt Zugriff auf npm und das
Node-Container-Image.

`--build` sorgt auch bei erneuten Deployments dafür, dass Änderungen am
Quellcode in das Image übernommen werden.

Bei Nutzung eines Reverse Proxys muss das Streaming von `/api/test` ohne
Response-Buffering möglich sein. Der Server setzt `X-Accel-Buffering: no`.

## Lokale Entwicklung

Node.js 22.12 oder neuer, pnpm 9 oder neuer:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Standardport: `3008`. Mit `PORT=3012 pnpm dev` lässt sich ein anderer Port wählen.

```bash
pnpm test
pnpm build
NODE_ENV=production pnpm start
```

Die Tests verwenden einen lokalen SMTP-Testserver und versenden keine externen
E-Mails. Sie prüfen unter anderem Verbindungstests, Mailannahme, abgelehnte
Anmeldung, abgelehnte Empfänger, STARTTLS und Eingabevalidierung.

## Daten und Zugriff

Zugangsdaten werden für den Test an diesen App-Server übermittelt und von dort
an den angegebenen SMTP-Server. Die App speichert sie nicht dauerhaft und
übernimmt sie nicht in Ergebnisexporte. Im Browser wird nur die Designauswahl
gespeichert. Das Formular und die Ergebnisse bleiben bis zum Zurücksetzen oder
Schließen im Arbeitsspeicher der Seite.

Die App besitzt keine eigene Benutzeranmeldung. Für den Betrieb außerhalb eines
vertrauenswürdigen Netzes ist ein vorgeschalteter Zugangsschutz mit HTTPS nötig.
Interne SMTP-Ziele sind bewusst erlaubt. Es können maximal vier Tests gleichzeitig
laufen; Timeouts gelten pro Netzwerk-Schritt.

## Technik

React, TypeScript und Vite für die Oberfläche; Express und Nodemailer für den
SMTP-Testserver. Das Produktionsimage enthält die gebaute App und ihre
Laufzeitabhängigkeiten.
