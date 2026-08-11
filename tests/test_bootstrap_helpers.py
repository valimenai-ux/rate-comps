"""Unit checks for the bootstrap's TLS-interception fallback (RateComps.py).

The retry must trigger only on certificate-verification failures - never on
ordinary network or resolution errors - and must relax checks for exactly
the two pypi hosts, nothing else.
"""

from __future__ import annotations

import RateComps


def test_detects_corporate_tls_interception() -> None:
    real_output = (
        "Could not fetch URL https://pypi.org/simple/pyyaml/: There was a "
        "problem confirming the ssl certificate: HTTPSConnectionPool(...): "
        "Max retries exceeded with url: /simple/pyyaml/ (Caused by SSLError("
        "SSLCertVerificationError(1, '[SSL: CERTIFICATE_VERIFY_FAILED] "
        "certificate verify failed: self signed certificate in certificate "
        "chain (_ssl.c:1129)')))"
    )
    assert RateComps._looks_like_ssl_interception(real_output)


def test_ignores_non_certificate_failures() -> None:
    assert not RateComps._looks_like_ssl_interception(
        "ERROR: No matching distribution found for PyYAML<7,>=6.0"
    )
    assert not RateComps._looks_like_ssl_interception(
        "ReadTimeoutError: HTTPSConnectionPool(host='pypi.org', port=443): "
        "Read timed out."
    )
    assert not RateComps._looks_like_ssl_interception("")


def test_trusted_hosts_limited_to_pypi() -> None:
    args = RateComps.TRUSTED_HOST_ARGS
    hosts = [args[i + 1] for i, a in enumerate(args) if a == "--trusted-host"]
    assert hosts == ["pypi.org", "files.pythonhosted.org"]
    # Nothing but --trusted-host pairs in there.
    assert len(args) == 2 * len(hosts)
