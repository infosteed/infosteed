# Internal HTTPS

Use internal TLS only when the application hostname resolves privately and public ACME validation cannot reach the server.

The installer selects `deploy/Caddyfile.internal`, starts Caddy's private CA, and exports only its public root certificate:

```text
deploy/infosteed-local-ca.crt
```

Compare the SHA-256 fingerprint printed by the installer with the certificate before trusting it:

```bash
openssl x509 -in deploy/infosteed-local-ca.crt -noout -fingerprint -sha256
```

Never copy anything from Caddy's `pki/authorities/local` directory other than `root.crt`. The private key must remain inside the protected Caddy data volume.

## Debian and Ubuntu clients

```bash
sudo install -m 0644 deploy/infosteed-local-ca.crt \
  /usr/local/share/ca-certificates/infosteed-local-ca.crt
sudo update-ca-certificates
```

Restart the browser after updating trust.

## Windows clients

Open `certmgr.msc`, select **Trusted Root Certification Authorities**, import `infosteed-local-ca.crt`, verify the displayed fingerprint, and restart the browser. Use the Local Computer store only when all users should trust the internal service.

## macOS clients

Import the certificate into the System keychain with Keychain Access, open it, set SSL trust to **Always Trust**, authenticate the change, and restart the browser.

## Firefox

Firefox may use its own certificate store. Open **Settings → Privacy & Security → Certificates → View Certificates → Authorities**, import the certificate, and trust it for websites.

## Verify

Ensure private DNS points at the application host, then test without `-k`:

```bash
getent hosts mtl.infosteed.com
curl -I https://mtl.infosteed.com
```

Using `curl -k` only bypasses verification for a diagnostic; it does not install trust.
