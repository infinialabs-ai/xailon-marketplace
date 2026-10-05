---
name: threat-model
description: Builds a STRIDE threat model for a feature, service or change, grounded in the code - assets, trust boundaries, data flows, threats ranked by risk, and concrete mitigations.
when-to-use: When the user asks for a threat model, a security design review, "what could go wrong" for a feature, or before shipping something that handles credentials, user data, payments or untrusted input.
argument-hint: "[feature, service or path]"
---

# Threat model

Work from the code, not from a generic checklist. Every threat you list must point at
a concrete component, file or data flow in this system.

## 1. Scope

State in one paragraph what is being modelled (the argument, the current change, or
the service the user named) and what is out of scope.

## 2. Map the system

Read entry points, routes, handlers, configuration and deployment files, then write:

- **Assets:** what an attacker wants: credentials, tokens, personal data, money,
  availability, integrity of builds.
- **Actors:** anonymous user, authenticated user, admin, other services, CI, operators.
- **Trust boundaries:** where data crosses from less to more trusted: network edge,
  process boundary, tenant boundary, browser to server, plugin to host.
- **Data flows:** a short list or a Mermaid `flowchart` of how requests and data move
  across those boundaries, naming the files that implement each hop.

## 3. Enumerate threats with STRIDE

For each trust boundary crossing, consider Spoofing, Tampering, Repudiation,
Information disclosure, Denial of service and Elevation of privilege. Keep only
threats that are plausible for this code. For each one record:

| ID | Category | Threat | Where (file:line) | Likelihood | Impact | Existing control |
|----|----------|--------|-------------------|------------|--------|------------------|

Rate likelihood and impact as Low, Medium or High, and say why in a few words.

## 4. Mitigations

For every Medium or High risk without an adequate existing control, give a specific
mitigation: the change, where it goes, and how to verify it (a test, a config check,
a log line). Prefer controls the codebase already uses elsewhere.

## 5. Output

Write the model to `docs/security/threat-model-<scope>.md` if a `docs/` folder exists,
otherwise print it. End with the three highest risks and whether they block shipping.
Do not claim the system is secure; say what was and was not examined.
