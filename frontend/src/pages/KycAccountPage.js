import React, { useState } from 'react';
import { FileBadge2, ShieldCheck, UserCheck, Users, Upload, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useBankTheme } from '../context/BankThemeContext';
import { toast } from 'sonner';

export default function KycAccountPage() {
  const { user } = useAuth();
  const { currentTheme } = useBankTheme();

  const [panDoc, setPanDoc] = useState(null);
  const [aadhaarDoc, setAadhaarDoc] = useState(null);
  const [addressDoc, setAddressDoc] = useState(null);
  const [uploading, setUploading] = useState(false);

  // Nominee update
  const [nomineeName, setNomineeName] = useState(user?.nominee?.name || 'Pooja Sharma');
  const [nomineeRelation, setNomineeRelation] = useState(user?.nominee?.relation || 'Spouse');

  // Joint Holder
  const [jointName, setJointName] = useState(user?.joint_holder_name || 'Ananya Sharma');
  const [jointPan, setJointPan] = useState('BLTPS4819M');

  const handleKycUpload = (e) => {
    e.preventDefault();
    setUploading(true);
    setTimeout(() => {
      setUploading(false);
      toast.success("KYC documents uploaded successfully! Sent to Branch Compliance Officer for verification.");
    }, 1200);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      
      {/* Header */}
      <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            KYC Compliance & Joint Account Management
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            RBI Master Direction KYC 2016 Compliant | Official Valid Documents (OVD)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1 rounded-full text-xs font-bold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4" /> KYC Status: {user?.kyc_status?.toUpperCase() || 'VERIFIED'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* KYC Document Upload Section */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <h2 className="font-bold text-white text-sm pb-2 border-b border-slate-800 flex items-center gap-2">
            <FileBadge2 className="w-4 h-4 text-cyan-400" />
            Upload Verified KYC Documents (Aadhaar / PAN / OVD)
          </h2>

          <form onSubmit={handleKycUpload} className="space-y-4 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Permanent Account Number (PAN Card)</label>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  readOnly
                  value={user?.pan_number || 'ABCPS8492K'}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                />
                <label className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-400 cursor-pointer border border-slate-700">
                  <Upload className="w-3.5 h-3.5 inline mr-1" /> Choose File
                  <input type="file" className="hidden" onChange={() => setPanDoc(true)} />
                </label>
              </div>
              {panDoc && <span className="text-[10px] text-emerald-400 mt-1 block">✓ PAN document attached</span>}
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Aadhaar Card / UIDAI Number (Masked)</label>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  readOnly
                  value={user?.aadhaar_number || 'XXXX-XXXX-4892'}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                />
                <label className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-400 cursor-pointer border border-slate-700">
                  <Upload className="w-3.5 h-3.5 inline mr-1" /> Choose File
                  <input type="file" className="hidden" onChange={() => setAadhaarDoc(true)} />
                </label>
              </div>
              {aadhaarDoc && <span className="text-[10px] text-emerald-400 mt-1 block">✓ Aadhaar document attached</span>}
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Proof of Address (Utility Bill / Passport)</label>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  readOnly
                  value="Electricity Bill - Nariman Point Apt #402"
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-300"
                />
                <label className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-400 cursor-pointer border border-slate-700">
                  <Upload className="w-3.5 h-3.5 inline mr-1" /> Choose File
                  <input type="file" className="hidden" onChange={() => setAddressDoc(true)} />
                </label>
              </div>
            </div>

            <button
              data-testid="submit-kyc-docs-btn"
              type="submit"
              disabled={uploading}
              className={`w-full py-3 rounded-xl ${currentTheme.buttonTheme} font-semibold`}
            >
              {uploading ? 'Encrypting & Storing Documents...' : 'Submit Documents for Compliance Verification'}
            </button>
          </form>
        </div>

        {/* Joint Holder & Nominee Registration */}
        <div className="space-y-6">
          
          {/* Nominee Form */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3 text-xs">
            <h3 className="font-bold text-white text-sm pb-2 border-b border-slate-800 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-emerald-400" />
              Registered Nominee Details (Banking Regulation Act Sec 45ZA)
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Nominee Full Name</label>
                <input
                  type="text"
                  value={nomineeName}
                  onChange={(e) => setNomineeName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Relationship</label>
                <input
                  type="text"
                  value={nomineeRelation}
                  onChange={(e) => setNomineeRelation(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                />
              </div>
            </div>

            <button
              onClick={() => toast.success("Nominee updated successfully!")}
              className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-400 font-semibold border border-slate-700"
            >
              Update Nominee Registration
            </button>
          </div>

          {/* Joint Account Holder Form */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3 text-xs">
            <h3 className="font-bold text-white text-sm pb-2 border-b border-slate-800 flex items-center gap-2">
              <Users className="w-4 h-4 text-purple-400" />
              Joint Account Co-Applicant (Either or Survivor Mode)
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Co-Applicant Name</label>
                <input
                  type="text"
                  value={jointName}
                  onChange={(e) => setJointName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Co-Applicant PAN</label>
                <input
                  type="text"
                  value={jointPan}
                  onChange={(e) => setJointPan(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono uppercase"
                />
              </div>
            </div>

            <button
              onClick={() => toast.success("Joint holder authorized on account!")}
              className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-purple-300 font-semibold border border-slate-700"
            >
              Authorize Joint Co-Signatory
            </button>
          </div>

        </div>

      </div>

    </div>
  );
}
