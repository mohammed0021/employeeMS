# Thesis V3 — front-matter deltas (Chapters 4 & 5)

Chapters 4 and 5 are delivered as Markdown (`chapter-4.md`, `chapter-5.md`). Paste them after the Chapter Three conclusion and before References, then apply the additions below to the front matter of the Word document to produce **V3**.

## Table of Contents — additions

```
CHAPTER FOUR .................................................................. 34

   4.1 SYSTEM IMPLEMENTATION ................................................................ 34
      4.1.1 Development environment ............................................................ 34
   4.2 PRESENTATION LAYER IMPLEMENTATION ..................................................... 35
      4.2.1 Authentication and session handling .............................................. 35
      4.2.2 Role-based dashboards ............................................................. 36
      4.2.3 Employee, department, and attendance management ................................. 36
      4.2.4 Leave workflow ................................................................... 37
      4.2.5 Payroll and payslips ............................................................. 37
      4.2.6 Reports, audit trail, and settings ............................................... 38
      4.2.7 Administrator user management .................................................... 38
   4.3 APPLICATION LAYER IMPLEMENTATION ...................................................... 38
      4.3.1 Input validation ................................................................. 39
      4.3.2 Permission enforcement ........................................................... 39
      4.3.3 Auditing (FR11) ................................................................. 39
      4.3.4 HR policy chatbot (FR07) ........................................................ 40
      4.3.5 AI-assisted performance feedback (FR08) ......................................... 40
      4.3.6 Attrition analytics (FR09) ...................................................... 41
   4.4 DATA LAYER IMPLEMENTATION ............................................................. 41
   4.5 CHAPTER SUMMARY ...................................................................... 42

CHAPTER FIVE ..................................................................... 43

   5.1 TESTING APPROACH ..................................................................... 43
   5.2 UNIT TESTING ......................................................................... 43
   5.3 INTEGRATION TESTING .................................................................. 44
   5.4 FUNCTIONAL TESTING ................................................................... 44
   5.5 PERFORMANCE TESTING .................................................................. 45
   5.6 USER ACCEPTANCE TESTING ............................................................... 46
   5.7 RESULTS AGAINST FUNCTIONAL REQUIREMENTS ................................................ 47
   5.8 RESULTS AGAINST NON-FUNCTIONAL REQUIREMENTS ........................................... 47
   5.9 LIMITATIONS ........................................................................... 48
   5.10 CONCLUSION ........................................................................... 48
```

> Page numbers above are placeholders — let Word regenerate them (update the whole ToC field) after pasting.

## List of Tables — additions

```
Table 4.1 Implementation Inventory of the AI-Powered EMS ................................... 34
Table 4.2 Extract from the Implemented Permission Matrix .................................. 39
Table 5.1 Testing Strategy -- Planned (Table 3.7) versus Implemented ....................... 43
Table 5.2 Functional (End-to-End) Test Scenarios and Results ............................... 44
Table 5.3 Performance Test Results (Production Build) ...................................... 45
Table 5.4 Functional Requirements Traceability .............................................. 47
Table 5.5 Non-Functional Requirements Assessment ............................................ 47
```

## List of Figures — additions

Figures are the 18 screenshots in `docs/screenshots/` (see `docs/screenshots/README.md` for the file-per-figure mapping). Insert each image at its marker in Chapter 4 with the caption shown:

```
Figure 4.1  Sign-in Page -- AI-Powered Employee Management System ......................... 35
Figure 4.2  Administrator Dashboard with Live Aggregates ................................... 36
Figure 4.3  Employee List with Pagination and Search ....................................... 36
Figure 4.4  Department Management ............................................................ 37
Figure 4.5  Attendance Register .............................................................. 37
Figure 4.7  Payroll Records and Payslip Generation ......................................... 38
Figure 4.8  HR Policy Chatbot ............................................................... 40
Figure 4.9  Performance Feedback Drafts ..................................................... 40
Figure 4.10 Attrition Risk Dashboard ........................................................ 41
Figure 4.11 Reports with Summary Statistics ................................................ 38
Figure 4.12 Audit Trail ..................................................................... 38
Figure 4.13 Account Settings and Password Change ........................................... 38
Figure 4.14 HR Leave Approvals Queue ........................................................ 37
Figure 4.15 HR Attendance Working View ..................................................... 37
Figure 4.16 Employee Dashboard -- Self-Scoped View ......................................... 36
Figure 4.17 Employee Leave Requests ......................................................... 37
Figure 4.18 Employee Chatbot View ........................................................... 40
```

> Figure 4.6 is intentionally unused (the numbering follows the capture script's fixed order so it can be re-run after UI changes without renumbering captions).

## Honest-results notes (do not edit these away)

- **UAT (§5.6):** the instrument exists (`docs/UAT-QUESTIONNAIRE.md`) but has NOT been administered to real participants yet. §5.6 is worded so nothing is fabricated; after you run the sessions with your supervisor/classmates, fill Part E of the questionnaire and optionally add the mean Likert scores to §5.6.
- **Attrition model (§5.9):** untrained — needs Python + the Kaggle IBM CSV. `scripts/train-attrition.py` is ready.
- **AI chatbot:** unconfigured key → honest-unavailable mode (asserted by E2E). `AI_MOCK=1` gives a clearly-badged deterministic stub for demo screenshots if desired.
- **Deployment (Phase 6):** still open — no remote/GitHub/Vercel account connected.
