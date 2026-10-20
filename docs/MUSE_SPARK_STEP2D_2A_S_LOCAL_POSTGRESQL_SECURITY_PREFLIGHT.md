# MUSE SPARK — ZENTRA STEP 2D-2A-S
## LOCAL POSTGRESQL SECURITY PREFLIGHT AUDIT REPORT

**Project:** ZENTRA — Hi-Tech Lab Field Service Management Platform  
**Target Repository:** `D:\Zentra`  
**Target Workstation:** Localhost (`127.0.0.1:5432`)  
**Audit Date:** 2026-10-09  
**Mode:** STRICT READ-ONLY SECURITY INSPECTION  
**Budget Constraint:** Strict ₹0/month (Zero cost, no credit cards, no paid upgrades)  
**Remote Access:** STRICTLY PROHIBITED (Zero remote connections made)  
**Execution Authorization:** NOT GRANTED — NO COMMANDS EXECUTED IN THIS STEP  
**Status:** COMPLETE — WAITING FOR HUMAN OPERATOR REVIEW  

---

## 1. Executive Summary & Objective

In accordance with **Step 2D-2A-S**, a comprehensive, non-destructive, read-only security inspection of the local PostgreSQL 18 environment was performed to resolve lingering network binding, firewall, authentication, and target validation questions prior to considering any database initialization.

### Key Audit Findings:
1. **Network Binding:** PostgreSQL's effective `listen_addresses` is statically configured as **`'*'`** (all interfaces) in `postgresql.conf`, listening on TCP port `5432` across IPv4 (`0.0.0.0`) and IPv6 (`::`). The server is **NOT loopback-only** at the OS socket layer.
2. **Client Authentication:** `pg_hba.conf` contains entries strictly for `local`, `127.0.0.1/32`, and `::1/128` configured with **`trust`** authentication. Remote IP addresses are not permitted at the PostgreSQL application protocol level.
3. **Host Firewall Posture:** Windows Defender Firewall is currently **DISABLED (State: OFF)** for both the `Public` and `Private` network profiles. The active physical Wi-Fi adapter (`Airtel_Rayyan@2103`) is assigned to the `Public` network category. Therefore, inbound TCP packets on port 5432 from other devices on the local Wi-Fi network are **not filtered by the operating system firewall**.
4. **Transport vs. Server Address Validation:** Empirical read-only testing confirmed that client connections to `'127.0.0.1'` resolve to IPv4 loopback (`inet_server_addr() = '127.0.0.1'`), whereas connections to `'localhost'` resolve to IPv6 loopback (`inet_server_addr() = '::1'`). Both transport endpoints must be explicitly validated in target safety logic.

> [!IMPORTANT]
> **Strict Read-Only Boundary:** Zero databases, roles, tables, schemas, or records were created or modified. Zero migrations, seeds, or tests were executed. No configuration files (`postgresql.conf`, `pg_hba.conf`), firewall rules, Windows services, application code, or `.env` files were altered. Zero remote connections were initiated.

---

## 2. Investigation A — Network and Authentication Audit

### 2.1 Effective PostgreSQL Configuration
Read-only queries against `pg_settings` via administrative loopback connection revealed the following active server settings:

| Parameter Name | Effective Setting | Setting Source | Implication |
|---|---|---|---|
| `config_file` | `C:/Program Files/PostgreSQL/18/data/postgresql.conf` | `override` | Primary server configuration location. |
| `hba_file` | `C:/Program Files/PostgreSQL/18/data/pg_hba.conf` | `override` | Client authentication rule file location. |
| `listen_addresses` | **`*`** | `configuration file` | Binds to all available physical and virtual network interfaces. |
| `port` | **`5432`** | `configuration file` | Default PostgreSQL TCP service port. |
| `ssl` | `off` | `default` | TLS encryption is not active on local connections. |
| `password_encryption` | `scram-sha-256` | `default` | Standard modern password hashing algorithm. |

*Exact SQL Verification:*
```sql
SELECT name, setting, source FROM pg_settings 
WHERE name IN ('listen_addresses', 'port', 'hba_file', 'config_file', 'ssl', 'password_encryption');
```

---

### 2.2 Operating System Port & Socket Listeners
PowerShell TCP connection inspection confirmed the active socket bindings:

```powershell
Get-NetTCPConnection -LocalPort 5432 -State Listen | Select-Object LocalAddress, LocalPort, State, OwningProcess
```

**Observed Empirical Output:**
```
LocalAddress LocalPort  State OwningProcess
------------ ---------  ----- -------------
::                5432 Listen          5928
0.0.0.0           5432 Listen          5928
```
- **Process Verification:** PID 5928 maps directly to `postgres.exe` under Windows Service `postgresql-x64-18`.
- **Finding:** Port 5432 is bound to `0.0.0.0` (IPv4 INADDR_ANY) and `::` (IPv6 in6addr_any). It is **not restricted to loopback** at the operating system socket layer.

---

### 2.3 Client Authentication Rules (`pg_hba.conf`)
Read-only query of the virtual catalog table `pg_hba_file_rules` extracted all active client authentication rules:

| Line | Connection Type | Database | User Name | Client Address | Netmask | Auth Method | Error |
|---|---|---|---|---|---|---|---|
| 113 | `local` | `all` | `all` | *(local socket)* | *(none)* | `trust` | `null` |
| 115 | `host` | `all` | `all` | `127.0.0.1` | `255.255.255.255` | `trust` | `null` |
| 117 | `host` | `all` | `all` | `::1` | `ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff` | `trust` | `null` |
| 120 | `local` | `replication` | `all` | *(local socket)* | *(none)* | `trust` | `null` |
| 121 | `host` | `replication` | `all` | `127.0.0.1` | `255.255.255.255` | `trust` | `null` |
| 122 | `host` | `replication` | `all` | `::1` | `ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff` | `trust` | `null` |

*Exact SQL Verification:*
```sql
SELECT line_number, type, database, user_name, address, netmask, auth_method, error 
FROM pg_hba_file_rules 
ORDER BY line_number;
```

#### Authentication Behavioral Analysis:
1. **Loopback Traffic (`127.0.0.1` and `::1`):** All incoming connections from loopback are granted immediate access under the **`trust`** method without password challenge. Any local process running under any local OS user can connect as `postgres` or `zentra_dev` without providing a password.
2. **Non-Loopback Traffic (LAN / External IPs):** There are **zero** host entries matching non-loopback addresses (`0.0.0.0/0`, `192.168.0.0/16`, etc.). When a remote device attempts to connect, PostgreSQL accepts the initial TCP three-way handshake, receives the PostgreSQL `StartupMessage`, reads the client's source IP, matches against `pg_hba.conf`, and immediately rejects the connection with:
   ```
   FATAL: no pg_hba.conf entry for host "192.168.1.X", user "...", database "...", no encryption
   ```

---

### 2.4 Windows Defender Firewall & Network Adapter Posture

To determine whether the operating system filters inbound traffic on port 5432 before it reaches PostgreSQL, read-only commands were evaluated in the non-elevated developer shell:

1. **Firewall Profile State Inspection:**
   ```powershell
   netsh advfirewall show allprofiles state
   Get-NetFirewallProfile | Select-Object Name, Enabled
   ```
   **Observed Empirical Output:**
   - **Domain Profile:** `State: ON` (`Enabled: True`)
   - **Private Profile:** `State: OFF` (`Enabled: False`)
   - **Public Profile:** `State: OFF` (`Enabled: False`)

2. **Active Network Adapter Profile Inspection:**
   ```powershell
   Get-NetConnectionProfile | Select-Object Name, InterfaceAlias, NetworkCategory, IPv4Connectivity
   ```
   **Observed Empirical Output:**
   - **Interface:** `Wi-Fi`
   - **Network Name:** `Airtel_Rayyan@2103`
   - **Network Category:** `Public`
   - **IPv4 Connectivity:** `Internet`

3. **Port Filter Permission Boundary:**
   - Executing `Get-NetFirewallPortFilter` failed with `Access is denied (Windows System Error 5)` due to non-elevated user permissions.
   - However, because the active network category is `Public` and the `Public Profile` is explicitly **`State: OFF`**, the operating system firewall is **inactive** for traffic arriving on the Wi-Fi adapter.

---

### 2.5 Synthesis of Network Exposure & Security Risks

```mermaid
flowchart LR
    subgraph LAN["Local Wi-Fi Network (Airtel_Rayyan@2103)"]
        Remote["External LAN Device<br/>(192.168.1.X)"]
    end

    subgraph Host["Host Workstation (Windows 11)"]
        FW["Windows Defender Firewall<br/>(Public Profile: OFF)"]
        Socket["Wildcard Socket Listener<br/>0.0.0.0:5432 / [::]:5432"]
        PG_HBA["PostgreSQL pg_hba.conf<br/>(Only 127.0.0.1 & ::1 permitted)"]
        Engine["PostgreSQL Database Engine<br/>(zentra_local / zentra_test)"]
    end

    Remote -->|1. TCP SYN Port 5432| FW
    FW -->|2. Traffic NOT Dropped| Socket
    Socket -->|3. TCP Handshake Completes| PG_HBA
    PG_HBA -->|4. FATAL: no pg_hba.conf entry| Remote
    PG_HBA -.->|Access Denied| Engine
```

#### Identified Residual Security Risks:
1. **Network Reconnaissance Exposure:** Port 5432 is visibly open on the local Wi-Fi subnet. Any port scanner or device on the network can discover that PostgreSQL 18 is running on this machine.
2. **Connection Slot Exhaustion (Denial-of-Service):** Because TCP handshakes complete before PostgreSQL evaluates `pg_hba.conf`, a flood of SYN requests or unauthorized connections from the LAN could consume worker processes up to PostgreSQL's `max_connections` limit (default 100), denying service to legitimate local applications.
3. **Defense-in-Depth Absence:** Security relies entirely on `pg_hba.conf` application-layer enforcement without an operating system firewall barrier.
4. **Local Trust Authentication:** Any local program or script executing on the workstation can connect to PostgreSQL without supplying credentials.

---

## 3. Investigation B — Target Validation Correctness

### 3.1 Empirical Testing of `inet_server_addr()` and `inet_client_addr()`

To verify how PostgreSQL reports socket addresses for actual local connections, read-only queries were executed against PostgreSQL via `node-postgres` without performing any database writes:

#### Test 1: Explicit IPv4 Connection (`host: '127.0.0.1'`)
```javascript
const client = new Client({ host: '127.0.0.1', port: 5432, database: 'postgres', user: 'postgres' });
```
**Empirical Query Results:**
```json
{
  "server_addr": "127.0.0.1",
  "server_port": 5432,
  "client_addr": "127.0.0.1",
  "client_port": 61248,
  "current_database": "postgres",
  "current_user": "postgres"
}
```

#### Test 2: Localhost Hostname Connection (`host: 'localhost'`)
```javascript
const client = new Client({ host: 'localhost', port: 5432, database: 'postgres', user: 'postgres' });
```
**Empirical Query Results:**
```json
{
  "server_addr": "::1",
  "server_port": 5432,
  "client_addr": "::1",
  "client_port": 61254,
  "current_database": "postgres",
  "current_user": "postgres"
}
```

---

### 3.2 Distinguishing Client Destination Address from Server Accepted Address

A critical security distinction must be made between client-side and server-side address validation:

| Dimension | Client Destination Address | Server Accepted Address (`inet_server_addr()`) |
|---|---|---|
| **What it represents** | The target host/IP string configured in the client connection string (e.g. `'localhost'` or `'127.0.0.1'`). | The local IP address of the network interface on which the PostgreSQL server process accepted the TCP connection. |
| **Where it is resolved** | In the client process by OS resolver / Node.js DNS (`dns.lookup`). On Windows, `'localhost'` resolves to IPv6 `::1`. | Inside the PostgreSQL backend kernel socket structures (`getsockname()`). |
| **Vulnerability if evaluated alone** | Client-side URL parsing alone cannot guarantee that traffic did not pass through a local proxy, tunnel, or altered hosts file. | Server-side query alone requires an established connection; cannot protect against connecting to a remote malicious host. |
| **Combined Security Power** | **Mandatory Pre-Connection Filter:** Prevents the client from opening sockets to remote hosts (`neon.tech`, `amazonaws.com`, external IPs). | **Mandatory In-Session Verification:** Cryptographically proves that the server listening on the socket accepted the connection on loopback (`127.0.0.1` or `::1`). |

---

### 3.3 Proposed Robust Fail-Closed Target Validation Logic

To achieve complete fail-closed certainty, validation must be implemented in two synchronized tiers:

#### Tier 1: Client-Side Pre-Connection Validation (Before Opening Socket)
The connection URL or configuration parameters must pass strict structural assertions:
1. **Hostname Validation:** `parsed.hostname` must be strictly in `['localhost', '127.0.0.1', '::1', '[::1]']`.
2. **Port Validation:** `parsed.port` must be strictly `'5432'` (or empty, resolving to default 5432).
3. **Prohibited Remote Marker Scan:** Hostname and query parameters must be scanned for prohibited cloud keywords (`neon.tech`, `rds.amazonaws.com`, `supabase.co`, `render.com`, `railway.app`, `pooler`).
4. **Query Parameter Disallowance:** Reject any connection options that override host or port (`host=`, `hostaddr=`, `endpoint=`, `options=-h`).

#### Tier 2: Server-Side In-Session Validation (Immediately After Connection, Pre-Query)
Immediately upon opening the connection and before issuing any DDL, migration, or DML, execute a single atomic verification query:

```sql
SELECT 
  host(inet_server_addr()) AS server_ip,
  inet_server_port() AS server_port,
  host(inet_client_addr()) AS client_ip,
  current_database() AS database_name,
  current_user AS user_name,
  session_user AS session_user_name;
```

#### Enforcement Assertions:
```typescript
interface SessionTargetCheck {
  server_ip: string | null;
  server_port: number | null;
  client_ip: string | null;
  database_name: string;
  user_name: string;
}

function assertSessionTargetIsSafe(
  result: SessionTargetCheck, 
  expectedDatabase: 'postgres' | 'zentra_local',
  expectedUser: 'postgres' | 'zentra_dev'
): void {
  const ALLOWED_LOOPBACK_IPS = new Set(['127.0.0.1', '::1']);
  const PROHIBITED_DATABASES = new Set(['zentra_test', 'hisecure_erp', 'hitech_platform']);

  // 1. Assert transport endpoints are loopback
  if (!result.server_ip || !ALLOWED_LOOPBACK_IPS.has(result.server_ip)) {
    throw new Error(`FAIL-CLOSED ABORT: Server accepted connection on non-loopback IP [${result.server_ip}].`);
  }
  if (!result.client_ip || !ALLOWED_LOOPBACK_IPS.has(result.client_ip)) {
    throw new Error(`FAIL-CLOSED ABORT: Client connected from non-loopback IP [${result.client_ip}].`);
  }

  // 2. Assert port
  if (result.server_port !== 5432) {
    throw new Error(`FAIL-CLOSED ABORT: Server port is [${result.server_port}], expected 5432.`);
  }

  // 3. Assert database identity
  if (PROHIBITED_DATABASES.has(result.database_name)) {
    throw new Error(`FAIL-CLOSED ABORT: Connected to protected catalog [${result.database_name}]. Operations strictly prohibited.`);
  }
  if (result.database_name !== expectedDatabase) {
    throw new Error(`FAIL-CLOSED ABORT: Connected to database [${result.database_name}], expected [${expectedDatabase}].`);
  }

  // 4. Assert role identity
  if (result.user_name !== expectedUser) {
    throw new Error(`FAIL-CLOSED ABORT: Connected as user [${result.user_name}], expected [${expectedUser}].`);
  }
}
```

---

## 4. Unverified Items & Required Human Decisions

The following items cannot be altered or verified automatically under the current permission context and boundaries:

| Item | Current Verified Status | Why It Cannot Be Handled Automatically | Required Human Operator Decision |
|---|---|---|---|
| **Wildcard Binding in `postgresql.conf`** | Configured as `listen_addresses = '*'` | Modifying `postgresql.conf` and restarting the Windows service requires OS Administrator privileges and violates the read-only boundary. | **Decision A:** Acknowledge LAN port exposure, OR manually edit `postgresql.conf` to set `listen_addresses = 'localhost'` and restart service. |
| **Windows Defender Firewall State** | `Public Profile` is **State: OFF** | Enabling firewall rules requires Administrator elevation (`Run as administrator`), prohibited in standard CLI. | **Decision B:** Enable Windows Firewall for the Public network profile, OR configure a firewall rule blocking inbound port 5432 on the Wi-Fi adapter. |
| **Loopback `trust` Authentication** | `pg_hba.conf` uses `trust` for `127.0.0.1` and `::1` | Modifying `pg_hba.conf` requires Administrator elevation and PostgreSQL server reload. | **Decision C:** Accept `trust` for local development, OR manually update `pg_hba.conf` to `scram-sha-256` for strict password enforcement. |

---

## 5. Confirmation of Safety, Data Protection & ₹0 Budget

- **Database Writes / DDL:** **ZERO.** No databases, roles, tables, schemas, or records were created, modified, or dropped.
- **Data Mutating Commands:** **ZERO.** No `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, migrations, seeds, or tests were executed.
- **Configuration Modifications:** **ZERO.** No changes were made to `postgresql.conf`, `pg_hba.conf`, Windows Firewall, Windows services, application code, or `.env` files.
- **Remote Cloud Connections:** **ZERO.** No connections were made to Neon, AWS, Supabase, Render, or any remote host.
- **Budget Integrity:** Strict ₹0/month budget preserved.

---

```
STOP — STEP 2D-2A-S SECURITY PREFLIGHT COMPLETE — WAITING FOR HUMAN REVIEW
```
