import React, { useState, useEffect } from 'react';
import {
  CreditCard, Lock, Unlock, ShieldAlert, KeyRound, FileText, RefreshCw,
  Eye, EyeOff, Snowflake, QrCode, Zap, Sparkles, CheckCircle2, Clock,
  Wifi, Globe, ShoppingBag, Ban, Copy, Info, Award, Building2, AlertTriangle,
  Ban as BanIcon
} from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';

// Network branding block
const NetworkBadge = ({ network }) => {
  const styles = {
    Visa: 'bg-[#1a1f71] text-white',
    RuPay: 'bg-gradient-to-r from-[#0b3b8c] via-[#0e6b47] to-[#00522f] text-white',
    Mastercard: 'bg-gradient-to-r from-[#c8102e] via-[#8b0e22] to-[#3d0713] text-white'
  };
  const label = { Visa: 'VISA', RuPay: 'RuPay', Mastercard: 'mastercard' };
  return (
    <span className={`px-2 py-1 rounded text-[10px] font-black tracking-wider ${styles[network] || 'bg-slate-800 text-white'}`}>
      {label[network] || network}
    </span>
  );
};

// Status pill
const StatusPill = ({ status }) => {
  const map = {
    active: { c: 'bg-emerald-50 text-emerald-700 border-emerald-200', i: CheckCircle2, l: 'Active' },
    dispatch_queued: { c: 'bg-amber-50 text-amber-700 border-amber-200', i: Clock, l: 'Dispatch Queued' },
    frozen: { c: 'bg-slate-100 text-slate-700 border-slate-200', i: Snowflake, l: 'Frozen' },
    hotlisted: { c: 'bg-rose-50 text-[#c8102e] border-rose-200', i: BanIcon, l: 'Hotlisted' },
    expired: { c: 'bg-slate-100 text-slate-600 border-slate-200', i: AlertTriangle, l: 'Expired' }
  };
  const s = map[status] || map.active;
  const Icon = s.i;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${s.c}`}>
      <Icon className="w-3 h-3" /> {s.l}
    </span>
  );
};

export default function CardsChequesPage() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState({});
  const [selected, setSelected] = useState(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [upiState, setUpiState] = useState(null);
  const [qrData, setQrData] = useState(null);
  const [tab, setTab] = useState('cards'); // cards | upi | cheques

  const [onlineLimit, setOnlineLimit] = useState(50000);
  const [atmLimit, setAtmLimit] = useState(40000);
  const [intl, setIntl] = useState(false);
  const [contactless, setContactless] = useState(true);
  const [ecom, setEcom] = useState(true);

  const [chequeLeaves, setChequeLeaves] = useState(25);
  const [chequeAddress, setChequeAddress] = useState('Registered Residential Address on KYC');
  const [stopChequeNo, setStopChequeNo] = useState('');
  const [stopReason, setStopReason] = useState('Cheque lost in transit');

  const fetchAll = async () => {
    try {
      setLoading(true);
      const [c, u] = await Promise.all([api.getCards(), api.upiStatus()]);
      setCards(c.cards || []);
      setUpiState(u);
      if (c.cards?.length && !selected) {
        setSelected(c.cards[0]);
        setOnlineLimit(c.cards[0].online_limit || 50000);
        setAtmLimit(c.cards[0].atm_limit || 40000);
        setIntl(c.cards[0].international_enabled || false);
        setContactless(c.cards[0].contactless_enabled !== false);
        setEcom(c.cards[0].ecom_enabled !== false);
      }
    } catch { toast.error("Failed to load card inventory"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []);

  const doAction = async (payload, successMsg) => {
    try {
      const res = await api.manageCard(payload);
      toast.success(res.message || successMsg);
      fetchAll();
    } catch (e) { toast.error(e.response?.data?.detail || 'Action failed'); }
  };

  const openQr = async () => {
    try {
      const q = await api.upiQr();
      setQrData(q);
      setShowQrModal(true);
    } catch { toast.error('QR unavailable'); }
  };

  const linkUpi = async (cardId) => {
    try {
      const r = await api.upiLinkCard({ card_id: cardId });
      toast.success(r.message);
      fetchAll();
    } catch (e) { toast.error(e.response?.data?.detail || 'Link failed'); }
  };

  if (loading) return (
    <div className="p-10 flex items-center justify-center min-h-[400px]">
      <RefreshCw className="w-5 h-5 animate-spin text-[#0b3b8c]" />
      <span className="ml-2 text-sm text-slate-600">Loading card vault…</span>
    </div>
  );

  const activeCount = cards.filter(c => c.status === 'active').length;
  const queuedCount = cards.filter(c => c.status === 'dispatch_queued').length;
  const blockedCount = cards.filter(c => c.status === 'hotlisted' || c.status === 'frozen').length;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">

      {/* Page header */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-[#0b3b8c]" /> Cards, UPI &amp; Cheques
            </h1>
            <p className="text-xs text-slate-600 mt-1 flex items-center gap-2">
              <Award className="w-3.5 h-3.5 text-emerald-600" />
              <span className="font-semibold text-slate-800">Issued by Bank Only</span>
              <span>· No third-party issuance · RBI card master direction compliant</span>
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <IconStat icon={CheckCircle2} label="Active" count={activeCount} color="text-emerald-700" />
            <IconStat icon={Clock} label="Queued" count={queuedCount} color="text-amber-700" />
            <IconStat icon={Ban} label="Blocked" count={blockedCount} color="text-[#c8102e]" />
            <IconStat icon={CreditCard} label="Total" count={cards.length} color="text-[#0b3b8c]" primary />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-5 border-b border-slate-100 -mx-5 px-5">
          {[
            { k: 'cards', l: 'Card Inventory', i: CreditCard },
            { k: 'upi', l: 'UPI on Debit Card', i: QrCode, badge: 'LAUNCHING TOMORROW' },
            { k: 'cheques', l: 'Cheque Book & Stop Cheque', i: FileText }
          ].map(t => (
            <button
              key={t.k}
              data-testid={`cards-tab-${t.k}`}
              onClick={() => setTab(t.k)}
              className={`px-4 py-2.5 text-xs font-semibold flex items-center gap-2 border-b-2 transition ${
                tab === t.k ? 'border-[#0b3b8c] text-[#0b3b8c]' : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <t.i className="w-3.5 h-3.5" /> {t.l}
              {t.badge && <span className="ml-1 px-1.5 py-0.5 rounded bg-[#c8102e] text-white text-[9px] font-bold animate-pulse">{t.badge}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* CARDS TAB */}
      {tab === 'cards' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {cards.map((card) => {
              const isActive = card.status === 'active';
              const isFrozen = card.status === 'frozen';
              const isHotlisted = card.status === 'hotlisted';
              const isQueued = card.status === 'dispatch_queued';
              const showCvv = revealed[card.id];
              const gradient = card.network === 'Visa'
                ? 'from-[#0b3b8c] via-[#1a4dae] to-[#2564cf]'
                : card.network === 'RuPay'
                ? 'from-[#0b3b8c] via-[#0e6b47] to-[#00522f]'
                : 'from-[#c8102e] via-[#8b0e22] to-[#3d0713]';

              return (
                <div key={card.id} data-testid={`card-item-${card.id}`}
                     className={`relative rounded-xl p-5 text-white overflow-hidden shadow-md border border-slate-200 bg-gradient-to-br ${gradient} ${isHotlisted ? 'opacity-70' : ''}`}>
                  <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/10 blur-xl" />
                  <div className="absolute -bottom-10 -left-10 w-40 h-40 rounded-full bg-black/10 blur-xl" />

                  {/* Card top */}
                  <div className="relative flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-white/70" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-white/90">
                          National Bharat Bank
                        </span>
                      </div>
                      <p className="text-[10px] text-white/70 mt-0.5">A/C {card.account_number}</p>
                    </div>
                    <NetworkBadge network={card.network} />
                  </div>

                  <div className="relative mt-6 flex items-center gap-3">
                    <div className="w-8 h-6 rounded bg-gradient-to-br from-yellow-200 to-yellow-500/70 flex items-center justify-center">
                      <div className="w-5 h-4 rounded-sm border border-yellow-800/40" />
                    </div>
                    <Wifi className="w-4 h-4 text-white/80 -rotate-90" />
                  </div>

                  {/* Card number */}
                  <p data-testid={`card-number-${card.id}`} className="relative font-mono text-lg tracking-widest text-white mt-3">
                    {card.card_number}
                  </p>

                  <div className="relative mt-3 flex justify-between items-end text-[11px]">
                    <div>
                      <p className="text-[9px] text-white/70 uppercase">Card Holder</p>
                      <p className="font-semibold">{card.card_holder}</p>
                    </div>
                    <div>
                      <p className="text-[9px] text-white/70 uppercase">Valid Thru</p>
                      <p className="font-mono font-semibold">{card.expiry_date}</p>
                    </div>
                    <div>
                      <p className="text-[9px] text-white/70 uppercase">CVV</p>
                      <div className="flex items-center gap-1 font-mono font-semibold">
                        <span>{showCvv ? card.cvv : '•••'}</span>
                        <button data-testid={`toggle-cvv-${card.id}`}
                          onClick={() => setRevealed(p => ({ ...p, [card.id]: !p[card.id] }))}
                          className="text-white/80 hover:text-white">
                          {showCvv ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Card meta */}
                  <div className="relative mt-4 pt-3 border-t border-white/20 flex items-center justify-between">
                    <StatusPill status={card.status} />
                    {card.upi_linked && (
                      <span className="text-[10px] font-semibold text-white bg-white/20 px-2 py-0.5 rounded">
                        UPI linked
                      </span>
                    )}
                  </div>

                  {/* Action row (icon-heavy) */}
                  <div className="relative mt-4 grid grid-cols-4 gap-1.5">
                    <IconAction disabled={isHotlisted || isQueued} testId={`freeze-${card.id}`}
                      icon={isFrozen ? Unlock : Snowflake} label={isFrozen ? 'Unfreeze' : 'Freeze'}
                      onClick={() => doAction({ card_id: card.id, action: isFrozen ? 'unfreeze' : 'freeze' })}
                      accent={isFrozen ? 'success' : 'warn'} />
                    <IconAction disabled={isHotlisted} testId={`pin-${card.id}`}
                      icon={KeyRound} label="Set PIN"
                      onClick={() => { setSelected(card); setShowPinModal(true); }} />
                    <IconAction disabled={isHotlisted} testId={`hotlist-${card.id}`}
                      icon={ShieldAlert} label="Hotlist" accent="danger"
                      onClick={() => {
                        if (window.confirm('Permanently hotlist and block this card?'))
                          doAction({ card_id: card.id, action: 'hotlist' });
                      }} />
                    <IconAction disabled={isHotlisted || card.upi_linked} testId={`upi-link-${card.id}`}
                      icon={QrCode} label={card.upi_linked ? 'Linked' : 'UPI'} accent="primary"
                      onClick={() => linkUpi(card.id)} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Card limits panel */}
          {selected && selected.status !== 'hotlisted' && (
            <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Zap className="w-4 h-4 text-[#0b3b8c]" /> Card Controls — {selected.card_number}
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                <div className="space-y-4 text-xs">
                  <SliderInput icon={ShoppingBag} label="Online / E-commerce Limit"
                    value={onlineLimit} onChange={setOnlineLimit} min={5000} max={200000} step={5000} testId="online-limit-slider" />
                  <SliderInput icon={CreditCard} label="ATM Withdrawal Limit"
                    value={atmLimit} onChange={setAtmLimit} min={5000} max={100000} step={5000} testId="atm-limit-slider" />
                </div>
                <div className="space-y-2 text-xs">
                  <ToggleRow icon={Globe} label="International Usage" desc="Enable transactions in foreign currency" checked={intl} onChange={setIntl} testId="intl-toggle" />
                  <ToggleRow icon={Wifi} label="Contactless Payments" desc="Tap-to-pay up to ₹5,000" checked={contactless} onChange={setContactless} testId="contactless-toggle" />
                  <ToggleRow icon={ShoppingBag} label="E-commerce & CNP" desc="Online purchases with OTP" checked={ecom} onChange={setEcom} testId="ecom-toggle" />
                </div>
              </div>

              <button data-testid="save-card-limits-btn"
                onClick={() => doAction({
                  card_id: selected.id, action: 'update_limits',
                  online_limit: parseFloat(onlineLimit), atm_limit: parseFloat(atmLimit),
                  international_enabled: intl, contactless_enabled: contactless, ecom_enabled: ecom
                })}
                className="mt-5 px-5 py-2.5 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-xs font-semibold">
                Save Security Limits
              </button>
            </div>
          )}
        </div>
      )}

      {/* UPI TAB */}
      {tab === 'upi' && upiState && (
        <div className="space-y-5">
          {/* Launch banner */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-md bg-[#0b3b8c] text-white flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <div className="inline-flex items-center gap-2 mb-1">
                  <span className="px-2 py-0.5 rounded bg-[#c8102e] text-white text-[10px] font-bold animate-pulse">
                    LAUNCHING TOMORROW
                  </span>
                  <span className="text-[10px] font-semibold text-amber-700 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Pending final approval
                  </span>
                </div>
                <h3 className="text-sm font-bold text-slate-900">{upiState.status_headline}</h3>
                <p className="text-xs text-slate-700 mt-1 max-w-2xl">{upiState.status_detail}</p>
              </div>
            </div>
            <button data-testid="upi-qr-btn" onClick={openQr}
              className="px-4 py-2.5 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-xs font-semibold flex items-center gap-2 whitespace-nowrap">
              <QrCode className="w-4 h-4" /> Show My UPI QR
            </button>
          </div>

          {/* UPI ID + limits */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <QrCode className="w-4 h-4 text-[#0b3b8c]" /> Your Primary UPI ID
              </h3>
              <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 bg-slate-50 border border-slate-200 rounded-md px-4 py-3 font-mono text-slate-900 font-semibold">
                  {upiState.primary_upi_id}
                </div>
                <button data-testid="copy-upi-btn"
                  onClick={() => { navigator.clipboard.writeText(upiState.primary_upi_id); toast.success('UPI ID copied'); }}
                  className="px-3 py-2.5 rounded-md border border-slate-200 hover:border-[#0b3b8c] text-slate-700 hover:text-[#0b3b8c] text-xs font-semibold flex items-center gap-1.5">
                  <Copy className="w-3.5 h-3.5" /> Copy
                </button>
              </div>

              <div className="grid grid-cols-3 gap-3 mt-5 text-xs">
                <MiniStat icon={Zap} value="₹1,00,000" label="Per Transaction" />
                <MiniStat icon={FileText} value="₹5,00,000" label="Daily Limit" />
                <MiniStat icon={ShieldAlert} value="4-digit PIN" label="UPI PIN" />
              </div>
            </div>

            {/* Link a card */}
            <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-[#0b3b8c]" /> Link Debit Card to UPI
              </h3>
              <p className="text-[11px] text-slate-500 mt-1">Choose a card issued by us to enable UPI.</p>
              <div className="mt-3 space-y-2">
                {upiState.linkable_cards.map(c => (
                  <div key={c.id} className="p-3 rounded-md border border-slate-200 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-slate-800 font-mono">•••• {c.card_number.split(' ').pop()}</div>
                      <div className="text-[10px] text-slate-500 flex items-center gap-1">
                        <NetworkBadge network={c.network} /> <StatusPill status={c.status} />
                      </div>
                    </div>
                    <button
                      disabled={c.upi_linked || c.status === 'hotlisted'}
                      data-testid={`upi-link-panel-${c.id}`}
                      onClick={() => linkUpi(c.id)}
                      className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition ${
                        c.upi_linked ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                        'bg-[#0b3b8c] text-white hover:bg-[#092e6f]'
                      }`}>
                      {c.upi_linked ? 'Linked' : 'Link'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Info footnote */}
          <div className="flex items-start gap-2 text-[11px] text-slate-600 p-3 bg-blue-50 border border-blue-100 rounded-md">
            <Info className="w-3.5 h-3.5 text-[#0b3b8c] shrink-0 mt-0.5" />
            UPI on Debit Card is being rolled out per NPCI circular. Final go-live requires NPCI approval — expected within 24 hours. Linked customers will get priority activation and a push notification.
          </div>
        </div>
      )}

      {/* CHEQUES TAB */}
      {tab === 'cheques' && selected && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#0b3b8c]" /> Request Cheque Book (CTS-2010)
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-600 mb-1">Leaves</label>
                <select data-testid="cheque-leaves-select" value={chequeLeaves}
                  onChange={e => setChequeLeaves(e.target.value)}
                  className="w-full border border-slate-200 rounded-md px-3 py-2 text-slate-900 bg-white">
                  <option value={25}>25 leaves</option>
                  <option value={50}>50 leaves</option>
                  <option value={100}>100 leaves</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-600 mb-1">Delivery address</label>
                <input value={chequeAddress} onChange={e => setChequeAddress(e.target.value)}
                  className="w-full border border-slate-200 rounded-md px-3 py-2 text-slate-900 bg-white truncate" />
              </div>
            </div>
            <button data-testid="submit-cheque-request-btn"
              onClick={async () => {
                try {
                  const r = await api.requestChequeBook({ account_number: selected.account_number, leaves_count: parseInt(chequeLeaves), delivery_address: chequeAddress });
                  toast.success(r.message);
                } catch { toast.error('Request failed'); }
              }}
              className="w-full py-2.5 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-xs font-semibold">
              Request Cheque Book
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Ban className="w-4 h-4 text-[#c8102e]" /> Emergency Stop Cheque
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <input data-testid="stop-cheque-number-input" value={stopChequeNo}
                onChange={e => setStopChequeNo(e.target.value)} placeholder="Cheque number"
                className="border border-slate-200 rounded-md px-3 py-2 text-slate-900 bg-white font-mono" />
              <input value={stopReason} onChange={e => setStopReason(e.target.value)}
                placeholder="Reason" className="border border-slate-200 rounded-md px-3 py-2 text-slate-900 bg-white" />
            </div>
            <button data-testid="confirm-stop-cheque-btn"
              onClick={async () => {
                if (!stopChequeNo) return toast.error('Enter cheque number');
                try {
                  const r = await api.stopCheque({ account_number: selected.account_number, cheque_number: stopChequeNo, reason: stopReason });
                  toast.success(r.message);
                  setStopChequeNo('');
                } catch { toast.error('Stop failed'); }
              }}
              className="w-full py-2.5 rounded-md border border-[#c8102e] text-[#c8102e] hover:bg-[#c8102e] hover:text-white text-xs font-semibold transition">
              Confirm Stop Payment
            </button>
          </div>
        </div>
      )}

      {/* Set PIN modal */}
      {showPinModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-sm w-full p-6 shadow-xl space-y-4 text-xs border border-slate-200">
            <h3 className="font-semibold text-slate-900 text-sm pb-2 border-b border-slate-100 flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-[#0b3b8c]" /> Green PIN Reset
            </h3>
            <div className="text-[11px] text-slate-500 flex items-start gap-2">
              <Info className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              An OTP will be sent to your registered mobile before the new PIN is activated.
            </div>
            <div>
              <label className="block text-slate-600 mb-1">Enter new 4-digit PIN</label>
              <input data-testid="new-pin-input" type="password" maxLength={4}
                value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))}
                placeholder="••••" className="w-full border border-slate-300 rounded-md px-3 py-2.5 text-center text-lg font-mono text-slate-900 tracking-widest" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setShowPinModal(false); setNewPin(''); }}
                className="flex-1 py-2 rounded-md border border-slate-200 text-slate-700">Cancel</button>
              <button data-testid="confirm-set-pin-btn"
                onClick={async () => {
                  if (newPin.length !== 4) return toast.error('Enter 4 digits');
                  await doAction({ card_id: selected.id, action: 'set_pin', new_pin: newPin });
                  setShowPinModal(false); setNewPin('');
                }}
                className="flex-1 py-2 rounded-md bg-[#0b3b8c] text-white font-semibold">Update PIN</button>
            </div>
          </div>
        </div>
      )}

      {/* QR modal */}
      {showQrModal && qrData && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-xl space-y-4 border border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <QrCode className="w-4 h-4 text-[#0b3b8c]" /> UPI Payment QR
            </h3>
            <div className="bg-slate-50 border border-slate-200 rounded-md p-6 flex flex-col items-center gap-3">
              <img
                data-testid="upi-qr-image"
                alt="UPI QR"
                className="w-48 h-48 bg-white p-2 rounded"
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData.upi_uri)}`}
              />
              <div className="text-center">
                <p className="text-xs text-slate-500">Pay to</p>
                <p className="text-sm font-semibold text-slate-900">{qrData.account_holder}</p>
                <p className="text-xs font-mono text-[#0b3b8c] mt-1">{qrData.upi_id}</p>
              </div>
            </div>
            <button onClick={() => setShowQrModal(false)}
              className="w-full py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ------- Small building blocks -------
function IconAction({ icon: Icon, label, onClick, disabled, testId, accent }) {
  const styles = {
    default: 'bg-white/20 hover:bg-white/30 text-white',
    danger: 'bg-white/10 hover:bg-white/25 text-white ring-1 ring-white/30',
    warn: 'bg-white/15 hover:bg-white/25 text-white',
    success: 'bg-emerald-500/80 hover:bg-emerald-500 text-white',
    primary: 'bg-white text-[#0b3b8c] hover:bg-slate-100'
  };
  return (
    <button data-testid={testId} disabled={disabled} onClick={onClick}
      className={`py-2 px-2 rounded-md text-[10px] font-semibold transition flex flex-col items-center justify-center gap-1 ${styles[accent] || styles.default} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}>
      <Icon className="w-4 h-4" /> <span>{label}</span>
    </button>
  );
}

function IconStat({ icon: Icon, label, count, color, primary }) {
  return (
    <div data-testid={`stat-${label.toLowerCase()}`}
      className={`px-3 py-1.5 rounded-md border ${primary ? 'border-[#0b3b8c] bg-blue-50' : 'border-slate-200 bg-white'} flex items-center gap-2`}>
      <Icon className={`w-3.5 h-3.5 ${color}`} />
      <span className={`text-[10px] ${color} font-semibold`}>{label}</span>
      <span className={`text-sm font-bold ${color}`}>{count}</span>
    </div>
  );
}

function SliderInput({ icon: Icon, label, value, onChange, min, max, step, testId }) {
  return (
    <div>
      <div className="flex justify-between text-slate-700 mb-1 items-center">
        <span className="flex items-center gap-1.5"><Icon className="w-3.5 h-3.5 text-[#0b3b8c]" /> {label}</span>
        <span className="font-bold text-[#0b3b8c] text-sm">₹{parseFloat(value).toLocaleString('en-IN')}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(e.target.value)} data-testid={testId}
        className="w-full accent-[#0b3b8c] cursor-pointer" />
    </div>
  );
}

function ToggleRow({ icon: Icon, label, desc, checked, onChange, testId }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-md border border-slate-200 bg-slate-50">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-[#0b3b8c]" />
        <div>
          <p className="font-semibold text-slate-900 text-xs">{label}</p>
          <p className="text-[10px] text-slate-500">{desc}</p>
        </div>
      </div>
      <button
        data-testid={testId}
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        className={`w-9 h-5 rounded-full transition flex items-center px-0.5 ${checked ? 'bg-[#0b3b8c]' : 'bg-slate-300'}`}>
        <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </button>
    </div>
  );
}

function MiniStat({ icon: Icon, value, label }) {
  return (
    <div className="p-3 rounded-md bg-slate-50 border border-slate-200 text-center">
      <Icon className="w-4 h-4 text-[#0b3b8c] mx-auto" />
      <p className="font-bold text-slate-900 mt-1">{value}</p>
      <p className="text-[10px] text-slate-500">{label}</p>
    </div>
  );
}
