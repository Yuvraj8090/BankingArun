import React, { useState } from 'react';
import { Bot, X, Send, Sparkles, ChevronRight } from 'lucide-react';
import { api } from '../services/api';

export default function ChatbotWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const quickPrompts = [
    "What are current FD interest rates?",
    "Where is the Chhutmalpur branch?",
    "What are the IMPS & UPI transfer limits?",
    "How to hotlist or block my debit card?"
  ];

  const handleSend = async (textToSend) => {
    const query = textToSend || input;
    if (!query.trim() || loading) return;

    const userMsg = { sender: 'user', text: query };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await api.chatWithBot(query);
      setMessages((prev) => [...prev, { sender: 'bot', text: res.response }]);
    } catch (err) {
      setMessages((prev) => [...prev, { sender: 'bot', text: "Sorry, I am having trouble connecting to the banking assistant. Please try again." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-50">
      {!isOpen && (
        <button
          data-testid="chatbot-floating-btn"
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2.5 px-4 py-3 rounded-full bg-gradient-to-r from-[#0b3b8c] to-[#0e4aa8] hover:from-[#0a2f6f] hover:to-[#0b3b8c] text-white font-semibold text-xs shadow-lg shadow-[#0b3b8c]/25 transition transform hover:scale-105 active:scale-95"
        >
          <Bot className="w-5 h-5 text-white" />
          <span>Ask AJS Assistant</span>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        </button>
      )}

      {isOpen && (
        <div data-testid="chatbot-window" className="w-96 max-w-[calc(100vw-2rem)] h-[520px] bg-white border border-slate-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          
          {/* Header */}
          <div className="bg-gradient-to-r from-[#0b3b8c] via-[#123f86] to-[#0b3b8c] p-3.5 border-b border-blue-200 flex items-center justify-between text-white">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#0e4aa8] to-[#0b3b8c] flex items-center justify-center">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="text-xs font-bold flex items-center gap-1.5">
                  AJSPay Assistant <Sparkles className="w-3 h-3 text-amber-600" />
                </h3>
                <p className="text-[10px] text-blue-100 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-300"></span> Online
                </p>
              </div>
            </div>
            <button
              data-testid="chatbot-close-btn"
              aria-label="Close chat"
              onClick={() => { setIsOpen(false); setMessages([]); }}
              className="p-1 rounded-lg hover:bg-white/10 text-slate-600 hover:text-slate-900"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs bg-slate-50">
            {messages.length === 0 && !loading && (
              <div className="py-2">
                <p className="text-[11px] text-slate-500 px-1 pb-2.5 leading-relaxed">
                  Ask me anything about your account, or start with one of these.
                </p>
                <div className="space-y-2">
                  {quickPrompts.map((p, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSend(p)}
                      data-testid={`chatbot-suggestion-${idx}`}
                      className="w-full text-left flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl
                        bg-white border border-slate-200 text-[11px] text-slate-700 leading-snug
                        hover:border-[#0b3b8c] hover:text-[#0b3b8c] hover:bg-blue-50/60 transition"
                    >
                      <span>{p}</span>
                      <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[82%] p-3 rounded-2xl ${
                    m.sender === 'user'
                      ? 'bg-blue-600 text-white rounded-br-none shadow-md shadow-blue-500/20'
                      : 'bg-slate-100 text-slate-700 border border-slate-200/80 rounded-bl-none'
                  }`}
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="p-3 bg-slate-100 text-slate-500 rounded-2xl rounded-bl-none border border-slate-200 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:0.2s]"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:0.4s]"></span>
                </div>
              </div>
            )}
          </div>

          {/* Input Box */}
          <form
            onSubmit={(e) => { e.preventDefault(); handleSend(); }}
            className="p-2.5 bg-white border-t border-slate-200 flex items-center gap-2"
          >
            <input
              data-testid="chatbot-input-field"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your banking query (e.g., FD rates)..."
              className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder-slate-500 focus:outline-none focus:border-[#0b3b8c]"
            />
            <button
              data-testid="chatbot-send-btn"
              type="submit"
              disabled={loading || !input.trim()}
              className="p-2 rounded-xl bg-[#0b3b8c] hover:bg-[#0a2f6f] disabled:opacity-50 text-white transition shadow-md shadow-indigo-600/30"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>

        </div>
      )}
    </div>
  );
}
