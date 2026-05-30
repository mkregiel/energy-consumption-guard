# Local HTTPS certificates

This folder holds mkcert-generated PEM files for local HTTPS development (`npm run dev:https`).

## Prerequisites

Install [mkcert](https://github.com/FiloSottile/mkcert):

```powershell
winget install FiloSottile.mkcert
```

## Generate certificates

```bash
npm run certs:generate
```

This creates (gitignored):

- `127.0.0.1+2.pem` — certificate
- `127.0.0.1+2-key.pem` — private key

## Regenerate

Delete the `.pem` files and run `npm run certs:generate` again. The script runs `mkcert -install` to ensure the local CA is trusted.

## Why HTTPS locally?

Tuya Developer Console requires `https://` callback URLs. Default `npm run dev` serves HTTP on port 4321, which cannot be registered as an OAuth redirect. Use `npm run dev:https` on `https://127.0.0.1:3000` for Tuya OAuth testing.
