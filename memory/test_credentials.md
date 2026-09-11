# Test Credentials

## Retail / Customer
- Email: `rahul.sharma@example.com`
- Password: `Banking@123`
- Transaction Password: `Txn@1234`
- Role: `retail`
- Account: `AJSP00984521098` (Savings) · Balance ₹1,45,850
- UPI ID: `rahulsharma@ajspay`
- Cards:
  - Visa Platinum Debit — `4532 9845 2109 8821` — Active — Exp 08/29
  - RuPay / Mastercard Global Debit — `5241 7373 2160 2721` — Dispatch Queued — Exp 06/31
  - RuPay / Mastercard Global Debit — `5241 9548 3082 4607` — Dispatch Queued — Exp 06/31

## Corporate
- Email: `tata.corp@example.com`
- Password: `Corporate@123`
- Transaction Password: `Corp@1234`
- Role: `corporate`
- Account: `AJSP00129845612` (Current) · Balance ₹12,85,000

## Branch Manager / Admin
- Email: `manager@ajspay.in`
- Password: `Admin@123`
- Role: `admin`
- Branch: AJSP-MUM-042 (Nariman Point Main)

## Bank Owner (CEO)
- Email: `owner@ajspay.in`
- Password: `Owner@123`
- Role: `bank_owner`

## Staff / Teller
- Email: `meera.staff@ajspay.in`
- Password: `Staff@123`
- Role: `staff`

## Collection Agent
- Email: `collections@ajspay.in`
- Password: `Collect@123`
- Role: `collection_agent`

## Loan Officer
- Email: `loans@ajspay.in`
- Password: `Loan@123`
- Role: `loan_officer`

## Key Endpoints
- `POST /api/auth/login`, `POST /api/auth/register`, `GET /api/auth/me`
- `GET /api/accounts`, `POST /api/accounts/transfer`
- `GET /api/cards`, `POST /api/cards/manage`, `POST /api/cards/request-physical`
- `GET /api/upi/status`, `POST /api/upi/link-card`, `GET /api/upi/qr`
- `GET /api/panel/bank-owner`, `GET /api/panel/staff`, `GET /api/panel/collection`, `GET /api/panel/loan-dept`
- `POST /api/panel/collection/action`, `POST /api/panel/loan-dept/decision`
- `GET /api/admin/overview`, `GET /api/admin/rbi-reports`
- `GET /api/hostinger/package`, `GET /api/hostinger/download-zip`
