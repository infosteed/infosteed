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

Ensure private DNS points at the application host:

```bash
getent hosts infosteed.internal
curl -I https://infosteed.internal
```

Using `curl -k` only bypasses verification for a diagnostic; it does not install trust.

To test the HTTPS listener on the application host without relying on DNS or proxy settings, force the connection to loopback while retaining the correct hostname for SNI and certificate verification:

```bash
curl --noproxy '*' \
  --cacert deploy/infosteed-local-ca.crt \
  --resolve infosteed.internal:443:127.0.0.1 \
  -I https://infosteed.internal
```

Inspect the leaf certificate when the wrong service appears to answer:

```bash
openssl s_client \
  -connect 127.0.0.1:443 \
  -servername infosteed.internal </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -fingerprint -sha256
```

The subject must name `infosteed.internal`, and the issuer must be the Caddy local authority whose root you exported. `Kubernetes Ingress Controller Fake Certificate` means a Kubernetes ingress is intercepting port 443 before the request reaches InfoSteed.

Browsers may use secure DNS or an explicit proxy instead of the operating system resolver. If the forced local test succeeds but a client still reaches the wrong service, disable secure DNS for the private hostname and add `infosteed.internal` to the client's proxy-bypass list.
