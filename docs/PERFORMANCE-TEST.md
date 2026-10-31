# Performance test — AI-Powered Employee Management System

Source: `scripts/perf-test.mjs` (thesis §3.8.4).

| # | Endpoint | Type | Status | Min (ms) | Median (ms) | Avg (ms) | P95 (ms) | Max (ms) | Within 2–3 s |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `/login` | page | 200 | 31 | 42 | 42 | 58 | 58 | ✅ |
| 2 | `/dashboard` | page (auth) | 200 | 1477 | 1581 | 1622 | 1813 | 1813 | ✅ |
| 3 | `/employees` | page (auth) | 200 | 1307 | 1384 | 1399 | 1643 | 1643 | ✅ |
| 4 | `/departments` | page (auth) | 200 | 852 | 901 | 925 | 1055 | 1055 | ✅ |
| 5 | `/attendance` | page (auth) | 200 | 1765 | 1824 | 1879 | 2214 | 2214 | ✅ |
| 6 | `/leave` | page (auth) | 200 | 1306 | 1404 | 1430 | 1665 | 1665 | ✅ |
| 7 | `/payroll` | page (auth) | 200 | 1731 | 1864 | 1851 | 2003 | 2003 | ✅ |
| 8 | `/chat` | page (auth) | 200 | 857 | 881 | 915 | 1065 | 1065 | ✅ |
| 9 | `/feedback` | page (auth) | 200 | 1867 | 1994 | 2144 | 2864 | 2864 | ✅ |
| 10 | `/attrition` | page (auth) | 200 | 1299 | 1513 | 1522 | 1853 | 1853 | ✅ |
| 11 | `/reports` | page (auth) | 200 | 946 | 1086 | 1101 | 1288 | 1288 | ✅ |
| 12 | `/audit` | page (auth) | 200 | 1120 | 1386 | 1369 | 1879 | 1879 | ✅ |
| 13 | `/settings` | page (auth) | 200 | 663 | 731 | 739 | 882 | 882 | ✅ |
| 14 | `/api/auth/me` | api | 200 | 631 | 664 | 698 | 851 | 851 | ✅ |
| 15 | `/api/employees?page=1&pageSize=25` | api | 200 | 1055 | 1125 | 1130 | 1268 | 1268 | ✅ |
| 16 | `/api/departments` | api | 200 | 825 | 888 | 912 | 1019 | 1019 | ✅ |
| 17 | `/api/attendance` | api | 200 | 1855 | 2008 | 2005 | 2198 | 2198 | ✅ |
| 18 | `/api/leave` | api | 200 | 1865 | 1955 | 1997 | 2289 | 2289 | ✅ |
| 19 | `/api/payroll` | api | 200 | 1263 | 1332 | 1342 | 1474 | 1474 | ✅ |
| 20 | `/api/reports/summary` | api | 200 | 1471 | 1579 | 1574 | 1784 | 1784 | ✅ |
| 21 | `/api/audit?pageSize=25` | api | 200 | 1065 | 1155 | 1168 | 1395 | 1395 | ✅ |
| 22 | `/api/policies` | api | 200 | 1042 | 1152 | 1150 | 1272 | 1272 | ✅ |
| 23 | `/api/chat/conversations` | api | 200 | 827 | 866 | 943 | 1403 | 1403 | ✅ |
| 24 | `/api/attrition/signals` | api | 200 | 1241 | 1292 | 1313 | 1476 | 1476 | ✅ |
| 25 | `/api/admin/users` | api | 200 | 1034 | 1150 | 1176 | 1480 | 1480 | ✅ |

**Run:** 2026-10-31T09:26:48.359Z · 15 measured request(s) per endpoint after 1 warm-up ·
25 endpoints · threshold 3000 ms.

Slowest endpoint by median: `/api/attendance` at 2008 ms. All endpoints met the < 2–3 s requirement.
