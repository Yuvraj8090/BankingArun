// Content for the public product pages behind the navbar and footer links.
// Each key is a real URL: /personal/savings-account, /loans/home-loan, and so on.
export const GROUP_LABEL = {
  personal: 'Personal Banking',
  loans: 'Loans',
  support: 'Support'
};

export const PRODUCTS = {
  'personal/savings-account': {
    "title": "Savings Account",
    "tagline": "Your member account for deposits, transfers between members and plan instalments.",
    "summary": "A zero-balance savings account for members, with the member portal, statements and transfers to other member accounts. Plan instalments and loan EMIs are taken from it automatically. Open it online with PAN and Aadhaar and finish verification by video KYC.",
    "highlights": [
        "Transfers between member accounts at no charge",
        "Instalments and EMIs taken from it automatically",
        "Statements as PDF or Excel, any date range",
        "Video KYC, no branch visit"
    ],
    "facts": [
        [
            "Interest",
            "Not paid on the savings balance: book a deposit plan to earn"
        ],
        [
            "Minimum balance",
            "Nil"
        ],
        [
            "Transfers",
            "Free, between member accounts"
        ],
        [
            "Statement",
            "PDF or Excel, any date range"
        ]
    ],
    "documents": [
        "PAN card",
        "Aadhaar or another officially valid document",
        "Recent photograph"
    ]
  },
  'personal/fixed-deposits': {
    "title": "Fixed Deposits",
    "tagline": "One lump sum at a fixed rate, with the maturity value shown before you book.",
    "summary": "Book a fixed deposit online from your savings account, or at the branch. Choose your own amount and tenure on the rate card, or one of our fixed plans such as Savadhi Yojana. As a Nidhi company, no deposit pays above 12.5% a year.",
    "highlights": [
        "Book online or at the branch",
        "Maturity value shown before you confirm",
        "Interest paid at maturity",
        "Loan against your deposit, up to 90% of it"
    ],
    "facts": [
        [
            "Rates",
            "On the Rates page, by tenure"
        ],
        [
            "Tenure",
            "6 months to 5 years; fixed plans up to 11 years 3 months"
        ],
        [
            "Highest rate",
            "12.5% a year (Nidhi Rules)"
        ],
        [
            "Early closure",
            "After the lock-in, at a reduced rate"
        ]
    ],
    "documents": [
        "An active member savings account",
        "Nominee details"
    ]
  },
  'personal/recurring-deposit': {
    "title": "Recurring Deposit",
    "tagline": "Save a fixed amount every month, or every day.",
    "summary": "Choose a plan and an instalment. The first is taken when you book and the rest come from your savings account automatically each month (or each day on a daily plan). The maturity value of every amount is printed in the plan table.",
    "highlights": [
        "Monthly plans from ₹500, daily plans from ₹50",
        "Instalments taken from savings automatically",
        "Maturity value fixed when you book",
        "Loan against what you have paid in"
    ],
    "facts": [
        [
            "Instalments",
            "Fixed amounts per plan"
        ],
        [
            "Tenure",
            "1 to 21 years, by plan"
        ],
        [
            "Collection",
            "From your savings account"
        ],
        [
            "Rates",
            "Shown per plan on the Rates page"
        ]
    ],
    "documents": [
        "An active member savings account",
        "Nominee details"
    ]
  },
  'loans/home-loan': {
    "title": "Loan Against Property",
    "tagline": "A loan secured on your house or land.",
    "summary": "Check your EMI with the calculator, then apply from your member account. The application goes to the loan department, which values the property and checks the documents. You can follow its status, and pay EMIs, from your account.",
    "highlights": [
        "EMI calculator before you apply",
        "Secured on your property",
        "Track the application in your member account",
        "EMIs taken from savings automatically"
    ],
    "facts": [
        [
            "Interest rate",
            "From 8.40% a year"
        ],
        [
            "Tenure",
            "Up to 20 years"
        ],
        [
            "Security",
            "Your house or land"
        ]
    ],
    "documents": [
        "PAN and Aadhaar",
        "Income proof: salary slips or ITR",
        "Property documents"
    ]
  },
  'loans/gold-loan': {
    "title": "Gold Loan",
    "tagline": "Borrow against your gold jewellery.",
    "summary": "Bring your jewellery to the branch for valuation and receive the loan against it. Your jewellery is kept at the branch until the loan is repaid.",
    "highlights": [
        "Our lowest loan rate",
        "Valuation at the branch",
        "Jewellery kept safe until repaid",
        "EMIs taken from savings automatically"
    ],
    "facts": [
        [
            "Interest rate",
            "From 7.90% a year"
        ],
        [
            "Valuation",
            "At the branch"
        ],
        [
            "Security",
            "Gold jewellery"
        ]
    ],
    "documents": [
        "PAN and Aadhaar",
        "Gold jewellery for valuation"
    ]
  },
  'loans/deposit-loan': {
    "title": "Loan Against Deposit",
    "tagline": "Borrow against your own FD or RD, without breaking it.",
    "summary": "Borrow up to 90% of what you have paid into an active deposit, from your member account. The deposit keeps earning; it cannot be closed early while the loan is open, and anything still owed at maturity is taken from the maturity amount first.",
    "highlights": [
        "Up to 90% of what you have paid in",
        "The deposit keeps earning",
        "Apply online, no income proof needed",
        "Repaid before the deposit matures"
    ],
    "facts": [
        [
            "Interest rate",
            "From 9.50% a year"
        ],
        [
            "Most you can borrow",
            "90% of what you have paid in"
        ],
        [
            "Tenure",
            "Up to the deposit’s maturity"
        ]
    ],
    "documents": [
        "An active deposit in your name"
    ]
  },
  'support/grievance-redressal': {
    "title": "Grievance Redressal",
    "tagline": "How to raise a complaint and what happens next.",
    "summary": "Raise a query from Help & Support in the member portal and you get a ticket number straight away. If you are not satisfied with the answer, escalate it from the same ticket to the grievance officer, who must reply within 30 days.",
    "highlights": [
        "Ticket number as soon as you file",
        "Fraud reports prioritised",
        "Follow every reply in your account",
        "Escalate to the grievance officer from the ticket"
    ],
    "facts": [
        [
            "Level 1",
            "Help & Support, in the member portal"
        ],
        [
            "Level 2",
            "Grievance officer, reply within 30 days"
        ],
        [
            "Helpline",
            "9105015464"
        ],
        [
            "Cyber fraud helpline",
            "1930"
        ]
    ],
    "documents": [
        "Your account details",
        "Transaction reference for the disputed entry"
    ]
  },
};

export const productAt = (group, slug) => PRODUCTS[`${group}/${slug}`];
