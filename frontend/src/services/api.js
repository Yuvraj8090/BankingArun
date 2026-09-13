import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';
const API = `${BACKEND_URL}/api`;

const getAuthHeaders = () => {
  const token = localStorage.getItem('banking_token');
  return {
    headers: {
      Authorization: token ? `Bearer ${token}` : '',
      'Content-Type': 'application/json'
    },
    withCredentials: true
  };
};

// Downloads are fetched with the auth header and saved from memory, so account
// numbers never appear in a URL, browser history or server log.
const saveBlob = (data, filename, type) => {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([data], { type }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
};

export const api = {
  // Accounts
  getAccounts: async () => (await axios.get(`${API}/accounts`, getAuthHeaders())).data,
  getTransactions: async (accountNumber = '') => {
    const url = accountNumber ? `${API}/accounts/transactions?account_number=${accountNumber}` : `${API}/accounts/transactions`;
    return (await axios.get(url, getAuthHeaders())).data;
  },
  transferFunds: async (payload) => (await axios.post(`${API}/accounts/transfer`, payload, getAuthHeaders())).data,
  bulkTransfer: async (payload) => (await axios.post(`${API}/accounts/bulk-transfer`, payload, getAuthHeaders())).data,

  // Cards
  getCards: async () => (await axios.get(`${API}/cards`, getAuthHeaders())).data,
  manageCard: async (payload) => (await axios.post(`${API}/cards/manage`, payload, getAuthHeaders())).data,
  requestPhysicalCard: async (accountNumber) =>
    (await axios.post(`${API}/cards/request-physical`, { account_number: accountNumber }, getAuthHeaders())).data,
  // The CVV is released only against the transaction password, and every reveal is logged.
  revealCvv: async (cardId, transactionPassword) =>
    (await axios.post(`${API}/cards/reveal-cvv`, { card_id: cardId, transaction_password: transactionPassword },
      getAuthHeaders())).data,

  // UPI
  upiStatus: async () => (await axios.get(`${API}/upi/status`, getAuthHeaders())).data,
  upiLinkCard: async (payload) => (await axios.post(`${API}/upi/link-card`, payload, getAuthHeaders())).data,
  upiQr: async () => (await axios.get(`${API}/upi/qr`, getAuthHeaders())).data,

  // Services
  requestChequeBook: async (payload) => (await axios.post(`${API}/services/cheque-book`, payload, getAuthHeaders())).data,
  stopCheque: async (payload) => (await axios.post(`${API}/services/stop-cheque`, payload, getAuthHeaders())).data,
  issueDemandDraft: async (payload) => (await axios.post(`${API}/services/demand-draft`, payload, getAuthHeaders())).data,

  // Deposits
  bookDeposit: async (payload) => (await axios.post(`${API}/deposits/book`, payload, getAuthHeaders())).data,

  // Loans
  applyLoan: async (payload) => (await axios.post(`${API}/loans/apply`, payload, getAuthHeaders())).data,
  getMyLoans: async () => (await axios.get(`${API}/loans/my-applications`, getAuthHeaders())).data,

  // Investments
  getInvestmentCatalog: async () => (await axios.get(`${API}/investments/catalog`, getAuthHeaders())).data,
  investMutualFund: async (payload) => (await axios.post(`${API}/investments/invest`, payload, getAuthHeaders())).data,
  getMyPortfolio: async () => (await axios.get(`${API}/investments/my-portfolio`, getAuthHeaders())).data,

  // Support & Branches
  registerComplaint: async (payload) => (await axios.post(`${API}/support/complaint`, payload, getAuthHeaders())).data,
  getMyTickets: async () => (await axios.get(`${API}/support/my-tickets`, getAuthHeaders())).data,
  getBranches: async () => (await axios.get(`${API}/branches/locator`, getAuthHeaders())).data,
  chatWithBot: async (message) => (await axios.post(`${API}/support/chat`, { message }, getAuthHeaders())).data,

  // Admin / Compliance
  getAdminOverview: async () => (await axios.get(`${API}/admin/overview`, getAuthHeaders())).data,
  adminKycAction: async (payload) => (await axios.post(`${API}/admin/kyc-action`, payload, getAuthHeaders())).data,
  getRbiReports: async () => (await axios.get(`${API}/admin/rbi-reports`, getAuthHeaders())).data,

  // Role Panels
  getBankOwnerPanel: async () => (await axios.get(`${API}/panel/bank-owner`, getAuthHeaders())).data,
  getStaffPanel: async () => (await axios.get(`${API}/panel/staff`, getAuthHeaders())).data,
  getCollectionPanel: async () => (await axios.get(`${API}/panel/collection`, getAuthHeaders())).data,
  collectionAction: async (payload) => (await axios.post(`${API}/panel/collection/action`, payload, getAuthHeaders())).data,
  getLoanDeptPanel: async () => (await axios.get(`${API}/panel/loan-dept`, getAuthHeaders())).data,
  loanDecision: async (payload) => (await axios.post(`${API}/panel/loan-dept/decision`, payload, getAuthHeaders())).data,

  // Hostinger export (admins and the bank owner only)
  getHostingerPackage: async () => (await axios.get(`${API}/hostinger/package`, getAuthHeaders())).data,
  downloadHostingerZip: async () => {
    const res = await axios.get(`${API}/hostinger/download-zip`, { ...getAuthHeaders(), responseType: 'blob' });
    saveBlob(res.data, 'hostinger_banking_php_mysql_package.zip', 'application/zip');
  },

  // OTP / MFA
  otpSend: async (payload) => (await axios.post(`${API}/otp/send`, payload, getAuthHeaders())).data,
  otpVerify: async (payload) => (await axios.post(`${API}/otp/verify`, payload, getAuthHeaders())).data,

  // Passkeys
  passkeyList: async () => (await axios.get(`${API}/passkey/list`, getAuthHeaders())).data,
  passkeyRegisterChallenge: async () => (await axios.post(`${API}/passkey/register/challenge`, {}, getAuthHeaders())).data,
  passkeyRegisterComplete: async (payload) => (await axios.post(`${API}/passkey/register/complete`, payload, getAuthHeaders())).data,
  passkeyDelete: async (id) => (await axios.delete(`${API}/passkey/${id}`, getAuthHeaders())).data,
  passkeyLoginChallenge: async (email) => (await axios.post(`${API}/passkey/login/challenge`, { email })).data,
  passkeyLoginComplete: async (payload) => (await axios.post(`${API}/passkey/login/complete`, payload, { withCredentials: true })).data,

  // Video KYC
  submitVideoKyc: async (payload) => (await axios.post(`${API}/kyc/video/submit`, payload, getAuthHeaders())).data,
  kycQueue: async () => (await axios.get(`${API}/kyc/video/queue`, getAuthHeaders())).data,
  kycDetail: async (id) => (await axios.get(`${API}/kyc/video/${id}`, getAuthHeaders())).data,
  kycDecision: async (payload) => (await axios.post(`${API}/kyc/video/decision`, payload, getAuthHeaders())).data,
  faceMatch: async (subId) => (await axios.get(`${API}/kyc/video/${subId}/face-match`, getAuthHeaders())).data,

  // Statements
  downloadStatement: async (kind, accountNumber, start, end) => {
    const isPdf = kind === 'pdf';
    const res = await axios.post(
      `${API}/statements/${isPdf ? 'pdf' : 'excel'}`,
      { account_number: accountNumber, start: start || null, end: end || null },
      { ...getAuthHeaders(), responseType: 'blob' }
    );
    saveBlob(
      res.data,
      `statement_${accountNumber}_${start || ''}_${end || ''}.${isPdf ? 'pdf' : 'xlsx'}`,
      isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  },

  // Referrals
  referralCode: async () => (await axios.get(`${API}/referrals/my-code`, getAuthHeaders())).data,
  referralHistory: async () => (await axios.get(`${API}/referrals/history`, getAuthHeaders())).data,

  // Standing Instructions
  siList: async () => (await axios.get(`${API}/standing-instructions`, getAuthHeaders())).data,
  siCreate: async (payload) => (await axios.post(`${API}/standing-instructions`, payload, getAuthHeaders())).data,
  siUpdate: async (id, payload) => (await axios.patch(`${API}/standing-instructions/${id}`, payload, getAuthHeaders())).data,
  siPause: async (id) => (await axios.post(`${API}/standing-instructions/${id}/pause`, {}, getAuthHeaders())).data,
  siResume: async (id) => (await axios.post(`${API}/standing-instructions/${id}/resume`, {}, getAuthHeaders())).data,
  siDelete: async (id) => (await axios.delete(`${API}/standing-instructions/${id}`, getAuthHeaders())).data,

  // Super-admin runtime config
  adminConfigGet: async () => (await axios.get(`${API}/admin/config`, getAuthHeaders())).data,
  adminConfigSet: async (payload) => (await axios.put(`${API}/admin/config`, payload, getAuthHeaders())).data,

  // Scheme master (back office only)
  schemesList: async () => (await axios.get(`${API}/schemes`, getAuthHeaders())).data,
  schemeCreate: async (payload) => (await axios.post(`${API}/schemes`, payload, getAuthHeaders())).data,
  schemeUpdate: async (id, payload) => (await axios.patch(`${API}/schemes/${id}`, payload, getAuthHeaders())).data,
  schemeDelete: async (id) => (await axios.delete(`${API}/schemes/${id}`, getAuthHeaders())).data,

  // Field agents and their collection records (no commission)
  agentsList: async () => (await axios.get(`${API}/agents`, getAuthHeaders())).data,
  agentCreate: async (payload) => (await axios.post(`${API}/agents`, payload, getAuthHeaders())).data,
  agentUpdate: async (id, payload) => (await axios.patch(`${API}/agents/${id}`, payload, getAuthHeaders())).data,
  agentDelete: async (id) => (await axios.delete(`${API}/agents/${id}`, getAuthHeaders())).data,
  agentCollections: async (id) => (await axios.get(`${API}/agents/${id}/collections`, getAuthHeaders())).data,
  collectionCreate: async (payload) => (await axios.post(`${API}/collections`, payload, getAuthHeaders())).data
};
