# User Acceptance Testing (UAT) — AI-Powered Employee Management System

**Thesis reference:** §3.8.5 *User Acceptance Testing (UAT)* and Table 3.7
("End-to-end workflows · Supervisor / user feedback · Goals confirmed").

**Purpose:** confirm with the project supervisor and a small number of end-users
that the delivered prototype meets the project objectives and is practically
useful for managing employees through HR processes.

**How to run it**

1. Deploy or run the system and seed demo data (`npm run db:seed`).
2. Give each participant the account matching the role they will play.
3. Ask them to complete the six tasks in Part B **without assistance**, timing
   each one. Answer only with "please try again" if they are stuck.
4. Part C is completed by the participant afterwards; Part D is completed by
   the evaluator per participant.
5. Record every comment verbatim in Part E.

**Pass criteria (from Table 3.7 — "Goals confirmed")**

- Every task in Part B completed without evaluator intervention.
- Median task time ≤ 3 minutes; every page/response under the 2–3 s target.
- Mean Likert score ≥ 4.0 for each of usability, reliability and usefulness.
- Zero data-loss incidents (no entered record disappears after save/refresh).

---

## Part A — Participant information

| Field | Value |
|---|---|
| Participant ID (P1, P2, …) | |
| Date | |
| Role played (Administrator / HR / Employee) | |
| Experience with HR software | None / Basic / Intermediate |
| Experience with web applications | Low / Medium / High |

*No names are recorded — participants stay anonymous in the thesis.*

---

## Part B — Task scenarios (end-to-end workflows)

| # | Task | Role | Pass criteria | Time (s) | ✅ / ❌ |
|---|---|---|---|---|---|
| B1 | Sign in, then sign out | Admin | Reaches dashboard; returns to login | | |
| B2 | Create a new employee and assign them to a department | Admin | Record visible in the employee list after reload | | |
| B3 | Record today's attendance for an employee | HR | Entry appears in attendance for the date | | |
| B4 | Submit an annual leave request, then have HR approve it | Employee → HR | Status transitions Requested → Approved | | |
| B5 | Run payroll for the period and open the payslip | HR | Correct base salary + bonus − deduction shown | | |
| B6 | Ask the AI assistant an HR policy question | Employee | Honest answer, or an explicit "unavailable" message (never a fabricated answer) | | |
| B7 | Review an employee's AI-drafted performance feedback and approve it | HR | Draft shown, marked as AI-generated, approved version stored | | |
| B8 | Open the attrition risk dashboard and identify a flagged employee | Admin | Risk score + contributing factors displayed, or an honest "model not trained" notice | | |

---

## Part C — Participant questionnaire (5-point Likert: 1 = Strongly disagree … 5 = Strongly agree)

| # | Statement | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| C1 | The interface is simple enough to use without technical training | | | | | |
| C2 | I could find employee, attendance, leave and payroll information quickly | | | | | |
| C3 | Page loads and operations felt fast enough for daily use (2–3 s) | | | | | |
| C4 | The system behaved reliably — no errors, no lost data | | | | | |
| C5 | Role permissions felt correct: I could only see and do what my role allows | | | | | |
| C6 | The AI answers were helpful, or clearly said when they could not help | | | | | |
| C7 | The attrition dashboard gave me insight I would not have had manually | | | | | |
| C8 | Overall, the system would save time compared with manual HR processes | | | | | |

**Open-ended questions**

1. What was the most useful part of the system?
2. What was the most confusing or frustrating part?
3. Which feature would you add or change first?
4. Any other comments:

---

## Part D — Evaluator checklist (completed per participant)

| Check | Result |
|---|---|
| All Part B tasks completed unaided | ✅ / ❌ |
| No data-loss observed during tasks | ✅ / ❌ |
| No console errors / broken navigation observed | ✅ / ❌ |
| Response times under 2–3 s (spot-check with browser tools) | ✅ / ❌ |
| AI output presented as *assisting* and reviewed by the user (NFR Accuracy) | ✅ / ❌ |
| Incidents / deviations noted | |

---

## Part E — Results summary (fill after all participants)

### E.1 Task completion

| Task | Participants attempted | Completed unaided | Median time (s) |
|---|---|---|---|
| B1 | | | |
| B2 | | | |
| B3 | | | |
| B4 | | | |
| B5 | | | |
| B6 | | | |
| B7 | | | |
| B8 | | | |

### E.2 Likert results (mean per statement)

| Statement | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 |
|---|---|---|---|---|---|---|---|---|
| Mean (n = ) | | | | | | | | |

### E.3 Verbatim feedback

| Participant | Most useful | Most confusing | Requested change |
|---|---|---|---|
| | | | |

### E.4 Conclusion

- **Goals confirmed (Table 3.7):** Yes / No — because:
- **NFR assessment:** Performance ☐ met · Security ☐ met · UX ☐ met ·
  Reliability ☐ met · Accuracy ☐ met
- **Weaknesses identified and recommended improvements:**

---

*This instrument is an artifact of thesis §3.8.5. Raw completed sheets should be
kept separate from the submitted thesis and referenced by participant ID only.*
