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
  // Open to anyone: the plans actually on sale and the company's registration
  // particulars. No token — this is what the public site renders.
  publicSchemes: async () => (await axios.get(`${API}/public/schemes`)).data,
  // Member register and share allotment (Nidhi Rules 11)
  registerMembers: async (params) => (await axios.get(`${API}/register/members`, { ...getAuthHeaders(), params })).data,
  registerAdmit: async (payload) => (await axios.post(`${API}/register/admit`, payload, getAuthHeaders())).data,
  registerShares: async (payload) => (await axios.post(`${API}/register/shares`, payload, getAuthHeaders())).data,

  // Sanctions / PEP screening
  screeningHits: async (params) => (await axios.get(`${API}/screening/hits`, { ...getAuthHeaders(), params })).data,
  screeningAction: async (payload) => (await axios.post(`${API}/screening/action`, payload, getAuthHeaders())).data,
  screeningRun: async () => (await axios.post(`${API}/screening/run`, {}, getAuthHeaders())).data,
  screeningRerate: async () => (await axios.post(`${API}/screening/rerate`, {}, getAuthHeaders())).data,
  watchlist: async (params) => (await axios.get(`${API}/screening/watchlist`, { ...getAuthHeaders(), params })).data,
  watchlistAdd: async (payload) => (await axios.post(`${API}/screening/watchlist`, payload, getAuthHeaders())).data,

  // Data protection, DPDP Act 2023
  privacyQueue: async (params) => (await axios.get(`${API}/privacy/queue`, { ...getAuthHeaders(), params })).data,
  privacyRespond: async (payload) => (await axios.post(`${API}/privacy/respond`, payload, getAuthHeaders())).data,

  // Grievance escalation
  grievanceQueue: async (params) => (await axios.get(`${API}/grievance/queue`, { ...getAuthHeaders(), params })).data,
  grievanceResolve: async (id, payload) => (await axios.post(`${API}/grievance/${id}/resolve`, payload, getAuthHeaders())).data,
  ticketEscalate: async (id, payload) => (await axios.post(`${API}/tickets/${id}/escalate`, payload, getAuthHeaders())).data,

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

  // Branch and ATM network. The public locator reads the same table, so a change
  // here is visible on the public site straight away.
  branchesList: async () => (await axios.get(`${API}/branches`, getAuthHeaders())).data,
  branchCreate: async (payload) => (await axios.post(`${API}/branches`, payload, getAuthHeaders())).data,
  branchUpdate: async (id, payload) => (await axios.patch(`${API}/branches/${id}`, payload, getAuthHeaders())).data,
  branchDelete: async (id) => (await axios.delete(`${API}/branches/${id}`, getAuthHeaders())).data,

  // Content behind the public product pages.
  publicProducts: async () => (await axios.get(`${API}/public/products`)).data,
  publicCaptcha: async () => (await axios.get(`${API}/public/captcha`)).data,

  // Identity documents a member uploads for verification.
  kycDocuments: async () => (await axios.get(`${API}/kyc/documents`, getAuthHeaders())).data,
  kycDocumentUpload: async (payload) => (await axios.post(`${API}/kyc/documents`, payload, getAuthHeaders())).data,
  kycDocumentsQueue: async () => (await axios.get(`${API}/kyc/documents/queue`, getAuthHeaders())).data,
  publicEnquiry: async (payload) => (await axios.post(`${API}/public/enquiry`, payload)).data,
  productsList: async () => (await axios.get(`${API}/products`, getAuthHeaders())).data,
  productCreate: async (payload) => (await axios.post(`${API}/products`, payload, getAuthHeaders())).data,
  productUpdate: async (id, payload) => (await axios.patch(`${API}/products/${id}`, payload, getAuthHeaders())).data,
  productDelete: async (id) => (await axios.delete(`${API}/products/${id}`, getAuthHeaders())).data,
  collectionCreate: async (payload) => (await axios.post(`${API}/collections`, payload, getAuthHeaders())).data,

  // AI module: fraud/AML, loan grading, collection anomalies
  fraudQueue: async (status = 'open') => (await axios.get(`${API}/ai/fraud-queue?status=${status}`, getAuthHeaders())).data,
  fraudAction: async (payload) => (await axios.post(`${API}/ai/fraud-action`, payload, getAuthHeaders())).data,
  loanRescore: async () => (await axios.post(`${API}/ai/loan-rescore`, {}, getAuthHeaders())).data,
  collectionAnomalies: async () => (await axios.get(`${API}/ai/collection-anomalies`, getAuthHeaders())).data,

  // Security centre
  securityAudit: async () => (await axios.get(`${API}/security/audit`, getAuthHeaders())).data,
  securityEvents: async (severity) => (await axios.get(
    `${API}/security/events${severity ? `?severity=${severity}` : ''}`, getAuthHeaders())).data,
  securitySeal: async () => (await axios.post(`${API}/security/seal`, {}, getAuthHeaders())).data,

  // Public: which regulated services may be advertised (no session needed)
  publicFeatures: async () => (await axios.get(`${API}/public/features`)).data,

  // First-run tour
  tutorialState: async () => (await axios.get(`${API}/tutorial/state`, getAuthHeaders())).data,
  tutorialProgress: async (step) => (await axios.post(`${API}/tutorial/progress`, { step }, getAuthHeaders())).data,
  tutorialFinish: async (skipped, step) =>
    (await axios.post(`${API}/tutorial/finish`, { skipped, step }, getAuthHeaders())).data,
  tutorialRestart: async () => (await axios.post(`${API}/tutorial/restart`, {}, getAuthHeaders())).data,

  // CRM — staff only
  crmMembers: async (params = {}) =>
    (await axios.get(`${API}/crm/members?${new URLSearchParams(params)}`, getAuthHeaders())).data,
  crmMember: async (id) => (await axios.get(`${API}/crm/member/${encodeURIComponent(id)}`, getAuthHeaders())).data,
  crmLogInteraction: async (payload) => (await axios.post(`${API}/crm/interaction`, payload, getAuthHeaders())).data,
  crmLeads: async (params = {}) =>
    (await axios.get(`${API}/crm/leads?${new URLSearchParams(params)}`, getAuthHeaders())).data,
  crmLeadCreate: async (payload) => (await axios.post(`${API}/crm/leads`, payload, getAuthHeaders())).data,
  crmLeadUpdate: async (id, payload) => (await axios.patch(`${API}/crm/leads/${id}`, payload, getAuthHeaders())).data,
  crmTasks: async (params = {}) =>
    (await axios.get(`${API}/crm/tasks?${new URLSearchParams(params)}`, getAuthHeaders())).data,
  crmTaskCreate: async (payload) => (await axios.post(`${API}/crm/tasks`, payload, getAuthHeaders())).data,
  crmTaskUpdate: async (id, payload) => (await axios.patch(`${API}/crm/tasks/${id}`, payload, getAuthHeaders())).data,

  // Reporting
  reportsList: async () => (await axios.get(`${API}/reports`, getAuthHeaders())).data,
  reportRun: async (key, params = {}) =>
    (await axios.get(`${API}/reports/${key}?${new URLSearchParams(params)}`, getAuthHeaders())).data,
  reportExportUrl: (key, params = {}) => `${API}/reports/${key}/export?${new URLSearchParams(params)}`,
  reportExport: async (key, params = {}) => {
    const res = await axios.get(`${API}/reports/${key}/export?${new URLSearchParams(params)}`,
      { ...getAuthHeaders(), responseType: 'blob' });
    saveBlob(res.data, `${key}.${params.format === 'xlsx' ? 'xlsx' : 'csv'}`);
  }
};
