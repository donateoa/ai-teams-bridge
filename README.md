# ai-teams-bridge

Bridge locale che connette la chat AI Teams al Claude Code installato sulla tua macchina.

Il server Firebase di AI Teams **non chiama mai Claude**. Ogni sviluppatore del team esegue questo bridge sul proprio computer: è il tuo Claude, sul tuo disco, sotto il tuo controllo.

## Flusso

1. In chat scrivi `/claude <prompt>` (oppure `clear`/`compact`/`stop`)
2. Il frontend scrive un documento Firestore `commands/{id}` con `ownerUid = tuo`
3. Il tuo bridge (in ascolto su Firestore) lo raccoglie, lo marca `running` atomicamente, e lancia Claude Agent SDK con:
   - `cwd` = la cartella che hai configurato per quella chat (salvata solo in localStorage del tuo browser)
   - `permissionMode` = `plan` di default (sola lettura, zero modifiche senza conferma)
4. L'output di Claude viene pubblicato nella chat come messaggio `kind=claude-output`
5. Sessioni Claude per-chat sono salvate in `~/.ai-teams/sessions.json` (locale, non in cloud)

## Installazione

```bash
cd apps/ai-teams/bridge
npm install
npm run build
npm link   # così puoi usare `ai-teams-bridge` da ovunque
```

## Configurazione

Imposta queste variabili ambiente (consigliato: metterle in `~/.zshrc` o in un `.envrc` con direnv):

```bash
# Prese dopo aver creato il progetto Firebase per ai-teams (Terraform)
export AI_TEAMS_FIREBASE_API_KEY="AIza..."
export AI_TEAMS_FIREBASE_AUTH_DOMAIN="ai-teams-stg-XXXXXX.firebaseapp.com"
export AI_TEAMS_FIREBASE_PROJECT_ID="ai-teams-stg-XXXXXX"
export AI_TEAMS_FIREBASE_APP_ID="1:...:web:..."

# OAuth client di tipo "Desktop app" creato su console.cloud.google.com
export AI_TEAMS_GOOGLE_CLIENT_ID="XXXX.apps.googleusercontent.com"
export AI_TEAMS_GOOGLE_CLIENT_SECRET="..."

# Opzionale: plan | acceptEdits | default (default: plan)
export AI_TEAMS_PERMISSION_MODE="plan"
```

L'OAuth client Google va creato in Google Cloud Console → **APIs & Services → Credentials → Create Credentials → OAuth client ID → Application type: Desktop app**.

## Uso

```bash
# Primo login (apre browser per OAuth Google)
ai-teams-bridge login

# Verifica
ai-teams-bridge status

# Avvia listener (resta in foreground)
ai-teams-bridge start
```

Ora apri la chat web, scrivi `/claude <prompt>` e dovresti vedere la risposta arrivare.

## Sicurezza

- **Il path della cartella di lavoro non lascia mai la tua macchina**: è salvato solo in localStorage del browser.
- **Chiave Anthropic**: il bridge non la richiede a te. Il Claude Agent SDK usa la config già presente sul tuo sistema (OAuth Claude Code o `ANTHROPIC_API_KEY`).
- **Permission mode**: default `plan` — Claude pianifica ma non modifica file senza tua approvazione esplicita.
- **Redazione segreti**: l'output pubblicato in chat viene filtrato per pattern noti (chiavi AWS, token GitHub, JWT, chiavi Anthropic, ecc.) prima di essere inviato.
- **Token OAuth**: il refresh token Google è salvato nel Keychain macOS via `keytar`, non in plaintext.
- **Solo i tuoi command**: il bridge filtra `commands where ownerUid == tuo_uid`. Non vedrà mai i command di altri utenti della chat.

## Troubleshooting

- `loginfallito: Google non ha restituito un refresh token`  
  → vai su https://myaccount.google.com/permissions, revoca l'app, riprova.

- `Configurazione mancante`  
  → mancano variabili ambiente. Vedi sezione Configurazione.

- `bridge fermato: permission denied`  
  → le Firestore rules rifiutano: l'utente non è membro della chat del command, oppure `ownerUid` non combacia con l'uid con cui sei loggato.

## Limiti v1

- Solo macOS (Keychain). Linux/Windows richiedono backend alternativo per keytar.
- Nessun daemon (lanciare manualmente `ai-teams-bridge start`).
- Nessun multi-device coordinator: se hai 2 bridge attivi con lo stesso account, il primo che "claim" un command vince.
