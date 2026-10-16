import React, { useEffect, useState } from 'react';
import { FileBadge2, ShieldCheck, UserCheck, Users, Upload, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useBankTheme } from '../context/BankThemeContext';
import { toast } from 'sonner';
import DocumentUpload from '../components/DocumentUpload';
import { api } from '../services/api';

export default function KycAccountPage() {
  const { user } = useAuth();
  const { currentTheme } = useBankTheme();

  // Keyed by kind, so the page shows what has already been sent for review.
  const [docs, setDocs] = useState({});

  // Nominee update
  const [nomineeName, setNomineeName] = useState(user?.nominee?.name || '');
  const [nomineeRelation, setNomineeRelation] = useState(user?.nominee?.relation || '');
  const [nomineePwd, setNomineePwd] = useState('');
  const [savingNominee, setSavingNominee] = useState(false);

  // Joint Holder
  const [jointName, setJointName] = useState(user?.joint_holder_name || '');
  const [jointPan, setJointPan] = useState('');
  const [jointPwd, setJointPwd] = useState('');
  const [savingJoint, setSavingJoint] = useState(false);

  const saveNominee = async () => {
    setSavingNominee(true);
    try {
      const r = await api.updateNominee({
        nominee_name: nomineeName.trim(),
        nominee_relation: nomineeRelation.trim(),
        transaction_password: nomineePwd,
      });
      toast.success(r.message);
      setNomineePwd('');
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not save the nomination'); }
    finally { setSavingNominee(false); }
  };

  const saveJointHolder = async () => {
    setSavingJoint(true);
    try {
      const r = await api.updateJointHolder({
        is_joint: jointName.trim() !== '',
        joint_holder_name: jointName.trim(),
        joint_holder_pan: jointPan.trim(),
        transaction_password: jointPwd,
      });
      toast.success(r.message);
      setJointPwd('');
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not save the joint holder'); }
    finally { setSavingJoint(false); }
  };

  // What has already been sent for review, so a returning member sees it
  // rather than being invited to upload the same document again.
  useEffect(() => {
    api.kycDocuments()
      .then(({ documents }) => setDocs(Object.fromEntries((documents || []).map((d) => [d.kind, d]))))
      .catch(() => {});
  }, []);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      
      {/* Header */}
      <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            KYC Compliance & Joint Account Management
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            PAN &amp; Aadhaar based KYC | Officially Valid Documents (OVD)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1 rounded-full text-xs font-bold uppercase bg-emerald-500/20 text-emerald-700 border border-emerald-500/30 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4" /> KYC Status: {user?.kyc_status?.toUpperCase() || 'VERIFIED'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* KYC Document Upload Section */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xl space-y-4">
          <h2 className="font-bold text-slate-900 text-sm pb-2 border-b border-slate-200 flex items-center gap-2">
            <FileBadge2 className="w-4 h-4 text-[#0b3b8c]" />
            Upload Verified KYC Documents (Aadhaar / PAN / OVD)
          </h2>

          <div className="space-y-4 text-xs">
            <div>
              <label className="block text-slate-500 mb-1">Permanent Account Number (PAN Card)</label>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  readOnly
                  value={user?.pan_number || 'Not provided'}
                  className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-mono"
                />
                <div className="w-56 shrink-0"><DocumentUpload kind="pan" label="PAN card" hint="JPEG, PNG or PDF, up to 3 MB" existing={docs.pan} onUploaded={(r) => setDocs((v) => ({ ...v, pan: r.document }))} /></div>
              </div>
            </div>

            <div>
              <label className="block text-slate-500 mb-1">Aadhaar Card / UIDAI Number (Masked)</label>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  readOnly
                  value={user?.aadhaar_number || 'Not provided'}
                  className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-mono"
                />
                <div className="w-56 shrink-0"><DocumentUpload kind="aadhaar" label="Aadhaar / UIDAI document" hint="Mask all but the last four digits if you prefer" existing={docs.aadhaar} onUploaded={(r) => setDocs((v) => ({ ...v, aadhaar: r.document }))} /></div>
              </div>
            </div>

            <div>
              <label className="block text-slate-500 mb-1">Proof of Address (Utility Bill / Passport)</label>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  readOnly
                  value={docs.address ? `${docs.address.file_name || 'Document'} uploaded` : 'Not uploaded yet'}
                  className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-600"
                />
                <div className="w-56 shrink-0"><DocumentUpload kind="address" label="Proof of address" hint="A utility bill or passport, up to 3 MB" existing={docs.address} onUploaded={(r) => setDocs((v) => ({ ...v, address: r.document }))} /></div>
              </div>
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed pt-1">
              Each document is sent for review as you upload it. Your branch compliance officer
              checks them against the originals before your KYC status changes.
            </p>
          </div>
        </div>

        {/* Joint Holder & Nominee Registration */}
        <div className="space-y-6">
          
          {/* Nominee Form */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xl space-y-3 text-xs">
            <h3 className="font-bold text-slate-900 text-sm pb-2 border-b border-slate-200 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-emerald-700" />
              Registered Nominee Details (Banking Regulation Act Sec 45ZA)
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-500 mb-1">Nominee Full Name</label>
                <input
                  type="text"
                  value={nomineeName}
                  onChange={(e) => setNomineeName(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900"
                />
              </div>

              <div>
                <label className="block text-slate-500 mb-1">Relationship</label>
                <input
                  type="text"
                  value={nomineeRelation}
                  onChange={(e) => setNomineeRelation(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-500 mb-1">Transaction password</label>
              <input
                type="password"
                value={nomineePwd}
                onChange={(e) => setNomineePwd(e.target.value)}
                data-testid="nominee-txn-password"
                placeholder="Required to change a nomination"
                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900"
              />
            </div>

            <button
              type="button"
              onClick={saveNominee}
              disabled={savingNominee || !nomineeName.trim() || !nomineeRelation.trim() || !nomineePwd}
              data-testid="nominee-save-btn"
              className="w-full py-2 rounded-xl bg-white hover:bg-emerald-50 text-emerald-700 hover:text-emerald-800 font-semibold border border-emerald-200 hover:border-emerald-300 transition disabled:opacity-50 disabled:hover:bg-white"
            >
              {savingNominee ? 'Saving…' : 'Update Nominee Registration'}
            </button>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              A nomination decides who the deposit is paid to, so the change is recorded
              against your account and kept in the audit trail.
            </p>
          </div>

          {/* Joint Account Holder Form */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xl space-y-3 text-xs">
            <h3 className="font-bold text-slate-900 text-sm pb-2 border-b border-slate-200 flex items-center gap-2">
              <Users className="w-4 h-4 text-purple-400" />
              Joint Account Co-Applicant (Either or Survivor Mode)
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-500 mb-1">Co-Applicant Name</label>
                <input
                  type="text"
                  value={jointName}
                  onChange={(e) => setJointName(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900"
                />
              </div>

              <div>
                <label className="block text-slate-500 mb-1">Co-Applicant PAN</label>
                <input
                  type="text"
                  value={jointPan}
                  onChange={(e) => setJointPan(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-mono uppercase"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-500 mb-1">Transaction password</label>
              <input
                type="password"
                value={jointPwd}
                onChange={(e) => setJointPwd(e.target.value)}
                data-testid="joint-txn-password"
                placeholder="Required to change a joint holder"
                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900"
              />
            </div>

            <button
              type="button"
              onClick={saveJointHolder}
              disabled={savingJoint || !jointPwd}
              data-testid="joint-save-btn"
              className="w-full py-2 rounded-xl bg-white hover:bg-blue-50 text-[#0b3b8c] hover:text-[#092e6f] font-semibold border border-blue-200 hover:border-[#0b3b8c] transition disabled:opacity-50 disabled:hover:bg-white"
            >
              {savingJoint ? 'Saving…' : jointName.trim() ? 'Authorize Joint Co-Signatory' : 'Remove Joint Co-Signatory'}
            </button>
          </div>

        </div>

      </div>

    </div>
  );
}
