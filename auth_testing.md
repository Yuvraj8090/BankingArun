# Authentication Testing Playbook

## Credentials
- Retail: `rahul.sharma@example.com` / `Banking@123` (Txn Pwd: `Txn@1234`)
- Corporate: `tata.corp@example.com` / `Corporate@123` (Txn Pwd: `Corp@1234`)
- Admin / Branch Manager: `manager.sbi@example.com` / `Admin@123`

## Quick Curl Verification:
```bash
curl -X POST http://localhost:8001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"rahul.sharma@example.com","password":"Banking@123"}'
```
Response contains access_token and user profile data with multi-account summary.
