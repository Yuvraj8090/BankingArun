import React from 'react';
import Modal from './Modal';
import { inr } from '../utils/format';
import { COMPANY } from '../data/company';

// The receipt a teller prints and hands over after taking a deposit at the counter.
// The server builds the slip (modules/banking.php: deposit_slip), so it shows what
// was actually recorded, not what the form held.
export default function DepositSlip({ slip, onClose }) {
  if (!slip) return null;
  const rows = [['Member', slip.member], ['Account number', slip.account_number], ...slip.lines,
    ['Date and time', `${slip.at} IST`], ['Received by', slip.received_by]];
  return (
    <Modal testId="deposit-slip-modal" title={slip.title || 'Deposit slip'} subtitle="Print it, sign it and give it to the member."
      onClose={onClose}
      footer={<>
        <button onClick={() => window.print()} data-testid="deposit-slip-print"
          className="px-4 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700">Print slip</button>
        <button onClick={onClose} className="px-5 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold">Done</button>
      </>}>
      <div className="print-slip p-4 border border-slate-200 rounded-md text-xs text-slate-800 space-y-3">
        <div className="text-center border-b border-slate-200 pb-2">
          <p className="font-bold text-sm text-slate-900">{COMPANY.legalName}</p>
          <p className="text-[11px] text-slate-500">{slip.title || 'Deposit receipt'} · No. <span className="font-mono">{slip.slip_no}</span></p>
        </div>
        <p className="text-center text-2xl font-extrabold text-emerald-700" data-testid="deposit-slip-amount">{inr(slip.amount, { decimals: 2 })}</p>
        <dl className="space-y-1">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-slate-500">{label}</dt><dd className="font-semibold text-right">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="grid grid-cols-2 gap-6 pt-8 text-[11px] text-slate-500">
          <p className="border-t border-slate-300 pt-1">Member's signature</p>
          <p className="border-t border-slate-300 pt-1 text-right">Cashier's signature and stamp</p>
        </div>
        <p className="text-[10px] text-slate-400">Keep this receipt. Quote its number for any question about it.</p>
      </div>
    </Modal>
  );
}
