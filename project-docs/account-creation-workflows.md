# Creating people in the system — who, where, and what it produces

Verified against the running backend on 2026-10-26 and updated the same day after decisions
D15–D17 (role authority, first passwords, specialist e-mail/specialty). Register numbers refer to
`DENEL_FRAMADA_AUDIT_2026-10-25.md`.

## 1. Four different things

| Thing | What it is | Created by | Needed for |
|---|---|---|---|
| **Login** (`user`) | The sign-in: e-mail, password, a **role** (what they may do) and the apps they may enter. | Every path below | Signing in at all |
| **Staff record** (`staff`) | The HR employment file: payslip, attendance, leave, documents. | HR → Add Staff, or an approved invite | Payroll, attendance, the Team app's self-service |
| **Specialist** (`specialists`) | The clinical/billing provider: specialty, commission %, withholding %, TIN, payout. | Portal → Specialists → Add specialist | Being bookable, being paid commission |
| **Doctor row** (`doctors`) | What an appointment actually points at. Made automatically from a specialist the first time anyone opens the scheduler, and it shows the specialist's specialty. | Automatic | Appointments |

**A user with the `doctor` role is not the same as a specialist.** The role only decides what the
login may do (full clinical access, no payments, no staff). The specialist record is what makes a
person appear in the scheduler and earn commission. That is why the `doctor` role cannot be given
from any generic role screen (the server refuses it): a `doctor` login with no specialist record
would have clinical access and be invisible to scheduling. Doctors are made only by **Add
specialist** (or *Grant portal login* on an existing specialist).

## 2. How each app signs people in

| App | Local | Sign-in | Used for |
|---|---|---|---|
| **HR app** | `localhost:5176` | e-mail + password | Staff records, payroll, **Add Staff**, invite links, **Access Management** (admin only) |
| **Clinic portal** | `localhost:5173` | e-mail + password | Patients, appointments, payments, **Specialists** (doctors) |
| **Team app** | `localhost:5175` | **phone number + SMS code — no password** | Staff self-service, lab cases |

The Team app has no password at all. A *Staff* or *Lab Technician* signs in with their phone number,
so **their phone number must be on their staff record**; the password set for them is never typed
by them and only matters if they are later given portal or HR access. Because of this the
"must choose a new password" rule applies to the portal and the HR app only, and the Team app is
left as it is (D18: owner decision).

The clinic portal has no screen for creating staff. Receptionists are created in the HR app.

## 3. Step by step

### A. Receptionist, lab technician, general staff

Who can do it: an **administrator** or an **HR administrator**.

1. HR app → **Staff** → **Add Staff**.
2. Steps 1–4: name, **e-mail** (required), **phone**, employment type (required), pay details. Enter the
   phone for a Staff or Lab Technician: it is how they sign in, and the wizard does not insist on it
   (F53). Everything else is optional.
3. Step 5 **Access**: an **initial password** (at least 10 characters) and the **System role**
   (required). An HR administrator is offered *Staff*, *Receptionist* and *Lab Technician*.
4. Save. Two requests run: the account is created, then the role is assigned. The first is all-or-nothing (login, password, second-factor row, staff record, Team-app access): if it fails nothing is kept, and the same name, e-mail and phone can be entered again straight away.

| Role | Signs in to |
|---|---|
| Receptionist | Clinic portal (e-mail + password) and Team app (phone + SMS code) |
| Lab technician, Staff | Team app only (phone + SMS code) |

A receptionist must choose their own password at first portal sign-in (unless you switched
*Require password change on first login* off).

### B. Administrator, HR Administrator, External Trainer

Who can do it: an **administrator only**. Same wizard; an administrator is also offered *Admin*,
*HR Administrator* and *External Trainer*. HR administrators and external trainers sign in to the
**HR app**; administrators to the portal and the HR app. Changing the role of someone who holds one
of these roles also needs an administrator (HR → Staff → their profile → **Edit access**, where an HR
administrator sees such a role read-only).

### C. Doctor who works in the clinic

Who can do it: an **administrator** (by default nobody else holds the permission).

1. Clinic portal → **Specialists** → **Add specialist**.
2. Name; **Type: Internal**; specialty; e-mail; phone; commission % and withholding % (0–100); TIN.
3. Switch on **Create a portal login** and set a **temporary password** (at least 10 characters).
4. **Create specialist.** It is one all-or-nothing write: if anything fails nothing is kept.

What you get: a login with role `doctor` that signs in to the **clinic portal only**, a specialist
record, and — the first time anyone opens the scheduler — a doctor row, so the doctor appears in the
appointment dropdown with their own specialty. **No staff record is created**: a doctor made here is
not an HR employee. The doctor chooses their own password at first sign-in.

The e-mail you set is the **sign-in address and cannot be changed from the Specialists screens**
(the Edit specialist sheet shows it read-only). The specialty can be edited and the scheduler follows.

### D. Visiting doctor (no login), and giving one a login later

1. Same screen, **Type: External**, no login. They are a billing record only; their contact e-mail
   stays editable.
2. Later: open the specialist → **Access** tab → **Grant portal login** (e-mail + temporary
   password). This makes them internal and creates the same login as in C.

### E. Staff who register themselves

1. HR app → Staff → **Generate link**; send it to the person.
2. They fill in the form and verify their phone with an SMS code.
3. HR app → Staff → **Pending registrations** → review → **Approve & create account**, choosing the
   role and employment type. An HR administrator can approve *Staff*, *Receptionist* or *Lab
   Technician* (or "assign later"); an administrator can approve any role. Approval is
   all-or-nothing too: if it fails the registration stays *Pending* and nothing is created, and two
   people approving it at the same moment make one account (the second is told it is no longer
   waiting for review).

What approval needs depends on the role:

| Role | What you must give | How they sign in |
|---|---|---|
| Assign later, Staff, Lab Technician | nothing | Team app, phone + SMS code |
| Receptionist, HR Administrator, External Trainer, Admin | the registrant's **e-mail** (they must have given one) and a **first password** (at least 12 characters, not a common word) | portal / HR app with that e-mail and password; they must choose their own at first sign-in |

## 4. What each admin role can and cannot do

| | Administrator | HR Administrator |
|---|---|---|
| Add staff | yes | yes |
| Assign Staff / Receptionist / Lab Technician | yes | yes, to people who hold one of those or no role |
| Assign Admin / HR Administrator / External Trainer | yes | **no** |
| Change someone who holds Admin / HR Administrator / Doctor / External Trainer | yes | **no** |
| Approve a self-registration | any role | Staff, Receptionist, Lab Technician only; no extra portal/HR grants |
| Reset a staff member's password | yes | yes, **not** an Administrator's |
| Per-person scopes and bundle grants (Edit access) | yes | no |
| Add or edit specialists / doctors | yes | no |
| Sign in to | portal, HR app | HR app only |

## 5. Known gaps

| # | What | State |
|---|---|---|
| F53 | The Add Staff wizard does not require a phone number, but a *Staff* or *Lab Technician* signs in with their phone number — without one they cannot sign in anywhere. The initial password the wizard asks for is never used by them either. | Observed, not changed (Team app left as it is, D18) |
| F45 | The portal's reset-password page says 8 characters where the server needs 12; a self-chosen password skips the weak-password list | Open |
| D14 | `errMessage()` returns SQL to the browser | Open (owner) |
