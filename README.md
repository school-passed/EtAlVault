[![Built with TideCloak](https://tide.org/badges/built-with-tidecloak.svg)](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked)

## Project overview

The Et Al. Vault protects shared research data from unilateral changes and releases by requiring three registered co-authors to approve every export.

Built with [TideCloak](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked).

### 1. Vision & originality

The Et Al. Vault gives research teams shared control over their raw data. Original datasets are sealed as versioned records, and approved exports remain tied to the exact version the team reviewed.

### 2. Trust constraint insight

A lab lead or administrator can often control shared research files alone, making silent edits or premature publication difficult for other contributors to challenge. Requiring independent co-author approval makes collaboration possible without giving one person unilateral release authority.

### 3. Value & impact

Researchers, students, and collaborators gain a clear record of data versions and publication decisions. For example, a researcher preparing a journal submission can request an export while all three registered co-authors review and approve it.

### 4. Why TideCloak matters

The app is designed as though TideCloak protects sign-in and server-side authorization. This prototype simulates TideCloak identities, roles, and access checks. The three-person export quorum is application logic; it is not presented as TideCloak QEA. No live TideCloak service is connected yet.

### 5. Prototype & storytelling

Sign in as a Researcher or PI and request an export, then switch to each Co-author identity and approve it. The server keeps the export blocked until all three votes are recorded. Try an unauthorized action and review the reason in the audit trail.

## Setup

Requires Node.js 18 or later. No package installation is needed.

```sh
node server.mjs
```

Open [http://localhost:4173](http://localhost:4173) and choose a demo identity. The prototype uses synthetic data and keeps sessions, requests, votes, and audit events in memory; they reset when the server restarts.
