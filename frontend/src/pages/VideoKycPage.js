import React, { useEffect, useRef, useState } from 'react';
import { Camera, ShieldCheck, Video, CheckCircle2, RefreshCw, Upload, RotateCcw, User, CreditCard, FileText, ChevronRight, AlertCircle } from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';

const LIVENESS_WORDS = ['MUMBAI', 'INDIA', 'DELHI', 'JAIPUR', 'KOLKATA'];

const STEPS = [
  { key: 'selfie', label: 'Selfie', icon: User, prompt: 'Look at the camera and stay steady' },
  { key: 'pan', label: 'PAN Card', icon: CreditCard, prompt: 'Hold your PAN card inside the frame' },
  { key: 'aadhaar', label: 'Aadhaar', icon: FileText, prompt: 'Hold your Aadhaar card inside the frame' }
];

export default function VideoKycPage() {
  const [step, setStep] = useState(0);
  const [captures, setCaptures] = useState({ selfie: null, pan: null, aadhaar: null });
  const [streamOn, setStreamOn] = useState(false);
  const [liveness, setLiveness] = useState(LIVENESS_WORDS[Math.floor(Math.random() * LIVENESS_WORDS.length)]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submissionId, setSubmissionId] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const startCam = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 720 }, audio: false });
      streamRef.current = s;
      if (videoRef.current) { videoRef.current.srcObject = s; }
      setStreamOn(true);
    } catch {
      toast.error('Camera permission denied. Please allow camera access.');
    }
  };
  const stopCam = () => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setStreamOn(false);
  };
  useEffect(() => () => stopCam(), []);

  const capture = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 480;
    canvas.getContext('2d').drawImage(videoRef.current, 0, 0, 640, 480);
    const b64 = canvas.toDataURL('image/jpeg', 0.75);
    const key = STEPS[step].key;
    setCaptures(c => ({ ...c, [key]: b64 }));
    toast.success(`${STEPS[step].label} captured`);
  };

  const retake = () => {
    const key = STEPS[step].key;
    setCaptures(c => ({ ...c, [key]: null }));
  };

  const goNext = () => {
    if (step < STEPS.length - 1) setStep(step + 1);
  };

  const submit = async () => {
    if (!captures.selfie || !captures.pan || !captures.aadhaar) {
      toast.error('Please capture all 3 items');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.submitVideoKyc({
        selfie_b64: captures.selfie,
        pan_b64: captures.pan,
        aadhaar_b64: captures.aadhaar,
        liveness_words: liveness,
        device_info: navigator.userAgent.slice(0, 120)
      });
      toast.success(res.message);
      setSubmissionId(res.submission_id);
      setSubmitted(true);
      stopCam();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Submission failed');
    } finally { setSubmitting(false); }
  };

  const stepDone = (i) => !!captures[STEPS[i].key];

  if (submitted) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
        <div className="bg-white border border-slate-200 rounded-lg p-8 shadow-sm text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-9 h-9 text-emerald-700" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Video KYC Submitted</h1>
          <p className="text-sm text-slate-600">
            Your submission ID is <span className="font-mono text-[#0b3b8c] font-semibold">{submissionId}</span>. Our branch officer will verify within 24 hours. You'll receive an email once approved.
          </p>
          <div className="grid grid-cols-3 gap-3 pt-4">
            {STEPS.map(s => (
              <div key={s.key} className="p-3 rounded-md border border-slate-200 bg-slate-50 text-center">
                <img alt={s.label} src={captures[s.key]} className="w-full h-20 object-cover rounded" />
                <p className="text-xs font-semibold text-slate-800 mt-2">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-[#0b3b8c] flex items-center justify-center"><Video className="w-5 h-5 text-slate-900" /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Video KYC — Instant Verification</h1>
            <p className="text-xs text-slate-500">PAN &amp; Aadhaar video KYC · No branch visit needed · Reviewed within 24 hours</p>
          </div>
        </div>
        {/* Progress */}
        <div className="mt-5 flex items-center gap-2">
          {STEPS.map((s, i) => (
            <React.Fragment key={s.key}>
              <button
                data-testid={`vkyc-step-${s.key}`}
                onClick={() => setStep(i)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                  i === step ? 'bg-[#0b3b8c] text-white'
                    : stepDone(i) ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-slate-50 text-slate-600 border border-slate-200'
                }`}>
                <s.icon className="w-3.5 h-3.5" /> {i + 1}. {s.label}
                {stepDone(i) && <CheckCircle2 className="w-3 h-3" />}
              </button>
              {i < STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-slate-500" />}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Camera */}
        <div className="lg:col-span-3 bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
          <div className="aspect-video bg-white rounded-md overflow-hidden relative flex items-center justify-center">
            <video ref={videoRef} autoPlay playsInline muted className={`w-full h-full object-cover ${streamOn ? '' : 'hidden'}`} />
            {!streamOn && (
              <div className="text-center text-slate-600 space-y-2">
                <Camera className="w-10 h-10 mx-auto" />
                <p className="text-sm">Camera preview will appear here</p>
                <button data-testid="vkyc-start-cam-btn" onClick={startCam}
                  className="px-4 py-2 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-xs font-semibold">
                  Start Camera
                </button>
              </div>
            )}
            {streamOn && captures[STEPS[step].key] && (
              <img alt="captured" src={captures[STEPS[step].key]} className="absolute inset-0 w-full h-full object-cover" />
            )}
            {streamOn && (
              <div className="absolute bottom-3 left-3 text-white text-xs bg-black/60 rounded px-2 py-1 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" /> LIVE
              </div>
            )}
          </div>

          {/* Instruction */}
          <div className="mt-4 p-3 rounded-md bg-blue-50 border border-blue-100 flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-[#0b3b8c] shrink-0 mt-0.5" />
            <div className="text-xs text-slate-700 flex-1">
              <b>Step {step + 1}:</b> {STEPS[step].prompt}. When ready, click <b>Capture</b>.
              {step === 0 && (<><br />Say aloud the word <b className="text-[#c8102e] font-mono">{liveness}</b> for liveness check.</>)}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            {!captures[STEPS[step].key] ? (
              <button data-testid={`vkyc-capture-${STEPS[step].key}`} disabled={!streamOn} onClick={capture}
                className="flex-1 py-2.5 rounded-md bg-[#c8102e] hover:bg-[#a30d25] text-white text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
                <Camera className="w-4 h-4" /> Capture {STEPS[step].label}
              </button>
            ) : (
              <>
                <button data-testid={`vkyc-retake-${STEPS[step].key}`} onClick={retake}
                  className="flex-1 py-2.5 rounded-md border border-slate-200 text-slate-700 hover:border-slate-400 text-xs font-semibold flex items-center justify-center gap-2">
                  <RotateCcw className="w-4 h-4" /> Retake
                </button>
                {step < STEPS.length - 1 ? (
                  <button data-testid={`vkyc-next-${STEPS[step].key}`} onClick={goNext}
                    className="flex-1 py-2.5 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-xs font-semibold flex items-center justify-center gap-2">
                    Next: {STEPS[step + 1].label} <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button data-testid="vkyc-submit-btn" disabled={submitting} onClick={submit}
                    className="flex-1 py-2.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                    {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    Submit for Verification
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Preview panel */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-3">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-700" /> Captured Documents
          </h3>
          {STEPS.map(s => (
            <div key={s.key} className={`p-3 rounded-md border ${captures[s.key] ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-slate-50'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <s.icon className={`w-4 h-4 ${captures[s.key] ? 'text-emerald-700' : 'text-slate-500'}`} />
                  <span className="text-xs font-semibold text-slate-800">{s.label}</span>
                </div>
                {captures[s.key] && <CheckCircle2 className="w-4 h-4 text-emerald-700" />}
              </div>
              {captures[s.key] && (
                <img alt={s.label} src={captures[s.key]} className="w-full h-24 object-cover rounded mt-2 border border-slate-200" />
              )}
            </div>
          ))}
          <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-500 space-y-1">
            <p>• 3 items required · Selfie is used only for face-match with your PAN card</p>
            <p>• All frames are transmitted over 256-bit TLS and stored encrypted</p>
            <p>• Manual verification by branch officer within 24 hours</p>
          </div>
        </div>
      </div>
    </div>
  );
}
