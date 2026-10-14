import React, { useEffect, useState } from 'react';
import {
  Award, RefreshCw, Copy, Check, Share2, MessageCircle, Mail, Users, ArrowRight, Info, Zap
} from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';

// A member's own view of the ladder.
//
// The director's screen lists everybody and their standing. A member only ever
// asks two things — where am I, and what do I do next — so the next step is the
// largest thing on the page and the ladder sits underneath it as context.
//
// There is no money on this page, and that is deliberate rather than an
// omission: a standing is recognition. The Nidhi Rules, 2014 forbid paying
// brokerage or incentive for bringing in deposits, so a figure printed beside a
// rung would read as a promise to pay it.

// Rendered inside My Network (ReferralPage), which already carries the invite link
// and the list of introduced members, so `embedded` leaves those two out.
export default function MyStandingPage({ embedded = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    try {
      setError(null);
      setData(await api.myStanding());
    } catch (e) {
      setError(e.response?.data?.detail || 'Your standing could not be loaded just now.');
    }
  };
  useEffect(() => { load(); }, []);

  const copy = () => {
    navigator.clipboard?.writeText(data.referral_link).then(() => {
      setCopied(true);
      toast.success('Link copied');
      setTimeout(() => setCopied(false), 2000);
    }, () => toast.error('Could not copy the link'));
  };

  if (error) {
    return (
      <div className="p-6 sm:p-10 max-w-lg">
        <div className="rounded-lg border border-[#c8102e]/40 bg-rose-50 p-5">
          <p className="text-sm font-semibold text-slate-900">Standing unavailable</p>
          <p className="text-[11px] mt-1.5 text-slate-700 leading-relaxed">{error}</p>
          <button onClick={load} data-testid="standing-retry"
            className="mt-3 px-4 py-2 rounded-md bg-[#0b3b8c] text-white text-xs font-semibold">
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!data) {
    return <div className="p-10 flex items-center gap-2 text-slate-600">
      <RefreshCw className="w-4 h-4 animate-spin" /> Loading your standing…
    </div>;
  }

  const msg = `Join me at AJS Pay Nidhi Limited — open a member account here: ${data.referral_link}`;
  const atTop = !data.next;

  return (
    <div className={embedded ? 'space-y-5' : 'p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-5'}>
      {/* Where you are */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-[#0b3b8c] text-white flex items-center justify-center shrink-0">
            <Award className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Your standing</p>
            <p data-testid="standing-current" className="text-2xl font-bold text-slate-900 leading-tight">
              {data.standing || 'Not yet on the ladder'}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {data.introduced_count === 0
                ? 'You have not introduced anyone yet.'
                : `You have introduced ${data.introduced_count} member${data.introduced_count === 1 ? '' : 's'}.`}
            </p>
          </div>
        </div>

        {/* The next step — the reason a member opens this page at all. */}
        <div data-testid="standing-next"
          className={`px-5 sm:px-6 py-5 border-t ${atTop
            ? 'bg-emerald-50 border-emerald-200' : 'bg-blue-50 border-blue-100'}`}>
          {atTop ? (
            <p className="text-sm font-semibold text-emerald-900">
              You are at the top of the ladder.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-[#0b3b8c] font-semibold">
                Next standing <ArrowRight className="w-3 h-3" /> {data.next.standing}
              </div>
              <p className="text-sm sm:text-base font-semibold text-slate-900 mt-1.5 leading-snug">
                {data.next.step}
              </p>
              <Progress have={data.next.have} needs={data.next.needs} />
            </>
          )}
        </div>
      </div>

      {/* How to actually do it */}
      {!atTop && !embedded && (
        <Section title="Your invitation link" icon={Share2}>
          <p className="text-[11px] text-slate-600 leading-relaxed mb-3">
            Anyone who opens a member account through this link and completes their KYC is counted
            as introduced by you. Your code is{' '}
            <strong className="font-mono text-slate-900">{data.referral_code}</strong>.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <code data-testid="standing-link"
              className="flex-1 min-w-0 text-[11px] bg-slate-50 border border-slate-200 rounded-md px-3 py-2.5 font-mono text-slate-700 break-all">
              {data.referral_link}
            </code>
            <button type="button" onClick={copy} data-testid="standing-copy"
              className="px-4 py-2.5 rounded-md bg-[#0b3b8c] hover:bg-[#092e6f] text-white text-xs font-semibold flex items-center justify-center gap-1.5 shrink-0 transition">
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <ShareButton icon={MessageCircle} label="WhatsApp"
              href={`https://wa.me/?text=${encodeURIComponent(msg)}`} testId="standing-share-whatsapp" />
            <ShareButton icon={MessageCircle} label="SMS"
              href={`sms:?&body=${encodeURIComponent(msg)}`} testId="standing-share-sms" />
            <ShareButton icon={Mail} label="Email"
              href={`mailto:?subject=${encodeURIComponent('Open an AJS Pay member account')}&body=${encodeURIComponent(msg)}`}
              testId="standing-share-email" />
          </div>
        </Section>
      )}

      {/* Who you introduced, and where each of them stands */}
      {!embedded && <Section title={`Members you introduced (${data.introduced_count})`} icon={Users}>
        {data.introduced.length === 0 ? (
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Nobody yet. Share the link above — each person who joins through it and completes their
            KYC appears here.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="standing-introduced">
            {data.introduced.map((m, i) => (
              <li key={i} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{m.name}</p>
                  <p className="text-[10px] text-slate-500">
                    Joined {new Date(m.joined_at).toLocaleDateString('en-IN')}
                  </p>
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border shrink-0 ${m.standing
                  ? 'bg-blue-50 text-[#0b3b8c] border-blue-200'
                  : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                  {m.standing || 'No standing yet'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>}

      {/* The ladder, for context rather than instruction */}
      <Section title="The ladder" icon={Award}>
        <p className="text-[11px] text-slate-600 mb-3 leading-relaxed">
          Each rung needs a number of the members you introduced to hold the rung below it. The
          first rung counts members of any standing.
        </p>
        <div className="overflow-x-auto -mx-1 px-1">
          <ol className="flex gap-2 min-w-max" data-testid="standing-ladder">
            {data.ladder.map((name, i) => {
              const level = i + 1;
              const reached = data.standing_level >= level;
              const isNext = data.next && data.next.standing === name;
              return (
                <li key={name}
                  className={`px-3 py-2 rounded-md border text-[11px] whitespace-nowrap ${reached
                    ? 'bg-[#0b3b8c] border-[#0b3b8c] text-white font-semibold'
                    : isNext ? 'bg-blue-50 border-[#0b3b8c] text-[#0b3b8c] font-semibold'
                    : 'bg-white border-slate-200 text-slate-500'}`}>
                  {name}
                  {isNext && <span className="block text-[9px] font-normal">you are working towards this</span>}
                </li>
              );
            })}
          </ol>
        </div>
      </Section>

      {/* Said plainly, because the ladder invites the opposite assumption. */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex gap-2.5">
        <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
        <p className="text-[11px] text-slate-800 leading-relaxed" data-testid="standing-note">
          {data.note}
        </p>
      </div>
    </div>
  );
}

function Progress({ have, needs }) {
  const pct = Math.min(100, Math.round((have / needs) * 100));
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-[10px] text-slate-600 mb-1">
        <span>{have} of {needs}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/70 overflow-hidden">
        <div className="h-full bg-[#0b3b8c] rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// Opens in a new tab and severs the opener: a share target should never get a
// handle back to a signed-in banking session.
function ShareButton({ icon: Icon, label, href, testId }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" data-testid={testId}
      className="px-3 py-2 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 text-[11px] font-semibold flex items-center gap-1.5 transition">
      <Icon className="w-3.5 h-3.5" /> {label}
    </a>
  );
}

function Section({ title, icon: Icon, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
      <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center gap-2">
        <Icon className="w-4 h-4 text-[#0b3b8c]" />
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
}
