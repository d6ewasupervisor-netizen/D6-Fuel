#!/usr/bin/env python3
import os
import socket
import ssl
import subprocess
import sys
import uvicorn

CERT_DIR = os.path.join(os.path.dirname(__file__), "certs")
CERT_FILE = os.path.join(CERT_DIR, "cert.pem")
KEY_FILE = os.path.join(CERT_DIR, "key.pem")


def get_local_ip():
    """Get the machine's LAN IP address."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "unknown"


def ensure_ssl_cert(local_ip):
    """Generate a self-signed certificate with the LAN IP as a SAN."""
    if os.path.isfile(CERT_FILE) and os.path.isfile(KEY_FILE):
        return True

    try:
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        import ipaddress
        from datetime import datetime, timedelta, timezone

        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

        subject = issuer = x509.Name([
            x509.NameAttribute(NameOID.COMMON_NAME, "Supplemental Intelligence Dev"),
        ])

        san_entries = [
            x509.DNSName("localhost"),
            x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
        ]
        if local_ip and local_ip != "unknown":
            san_entries.append(x509.IPAddress(ipaddress.ip_address(local_ip)))

        cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(datetime.now(timezone.utc))
            .not_valid_after(datetime.now(timezone.utc) + timedelta(days=365))
            .add_extension(x509.SubjectAlternativeName(san_entries), critical=False)
            .sign(key, hashes.SHA256())
        )

        os.makedirs(CERT_DIR, exist_ok=True)
        with open(KEY_FILE, "wb") as f:
            f.write(key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.TraditionalOpenSSL,
                serialization.NoEncryption(),
            ))
        with open(CERT_FILE, "wb") as f:
            f.write(cert.public_bytes(serialization.Encoding.PEM))

        print("  SSL certificate generated in certs/")
        return True
    except ImportError:
        print("  WARNING: 'cryptography' package not installed — falling back to HTTP")
        print("  Camera/barcode scanning will NOT work on mobile over HTTP.")
        print("  Install it with:  pip install cryptography")
        return False
    except Exception as e:
        print(f"  WARNING: Could not generate SSL cert: {e}")
        return False


def ensure_firewall_rule(port):
    """On Windows, add a firewall rule so mobile devices can connect."""
    if sys.platform != "win32":
        return
    rule_name = f"Supplemental Intelligence (port {port})"
    try:
        check = subprocess.run(
            ["netsh", "advfirewall", "firewall", "show", "rule", f"name={rule_name}"],
            capture_output=True, text=True,
        )
        if check.returncode == 0 and rule_name in check.stdout:
            return
        subprocess.run(
            [
                "netsh", "advfirewall", "firewall", "add", "rule",
                f"name={rule_name}", "dir=in", "action=allow",
                "protocol=TCP", f"localport={port}",
            ],
            capture_output=True, text=True,
        )
        print(f"  Firewall rule added for port {port}")
    except Exception as e:
        print(f"  Could not auto-add firewall rule: {e}")
        print(f"  If mobile devices can't connect, run as admin or manually allow TCP port {port}")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    local_ip = get_local_ip()
    use_ssl = ensure_ssl_cert(local_ip)
    scheme = "https" if use_ssl else "http"

    print()
    print("=" * 52)
    print("  Supplemental Intelligence")
    print("=" * 52)
    print(f"  Local:   {scheme}://localhost:{port}")
    print(f"  Network: {scheme}://{local_ip}:{port}")
    if use_ssl:
        print("  (self-signed cert — accept the browser warning)")
    print("=" * 52)
    print()

    ensure_firewall_rule(port)

    ssl_kwargs = {}
    if use_ssl:
        ssl_kwargs["ssl_keyfile"] = KEY_FILE
        ssl_kwargs["ssl_certfile"] = CERT_FILE

    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=True, **ssl_kwargs)
