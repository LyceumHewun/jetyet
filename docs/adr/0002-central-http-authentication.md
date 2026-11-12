# Central HTTP authentication with SSH-mediated revocation

Use Hysteria 2 HTTP authentication so the platform can deny users, enforce node authorization and rotate credentials without rewriting local user maps or restarting shared VPN services. Existing sessions are revoked through the loopback Traffic Stats API over SSH; failed disconnections stay pending. This deliberately trades new-connection availability during Web outages for central policy enforcement, with no local authentication fallback; existing sessions can continue during control-plane outages.
