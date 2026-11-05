export interface MockPurchaseItem {
  id: string;
  title: string;
  buyerId: string;
  agentId: string;
  merchantId: string;
  state: string;
  currency: string;
  amountMinor: number;
  capturedAmountMinor: number;
  refundedAmountMinor: number;
  paypalOrderId?: string;
  paypalAuthorizationId?: string;
  paypalCaptureId?: string;
  paypalRefundId?: string;
  createdAt: string;
  disputeId?: string;
  isTampered?: boolean;
}

export interface MockEvidenceEventItem {
  id: string;
  purchaseId: string;
  seq: number;
  type: string;
  actor: "user" | "agent" | "merchant" | "system" | "tribunal";
  payload: Record<string, unknown>;
  createdAt: string;
  prevHash: string;
  hash: string;
  signature: string;
  signerKeyId: string;
}

export interface MockDisputeItem {
  id: string;
  purchaseId: string;
  reason: string;
  status: "OPEN" | "IN_TRIBUNAL" | "RESOLVED" | "NEEDS_HUMAN_REVIEW";
  disputedAmountMinor: number;
  claimantActor: string;
  createdAt: string;
  resolvedAt?: string;
  resolutionState?: string;
  transcript: {
    step1Integrity: {
      passed: boolean;
      totalEvents: number;
      reason?: string;
    };
    buyerBrief: {
      argument: string;
      citedEvidenceIds: string[];
      faultAssessment: string;
    };
    merchantBrief: {
      argument: string;
      citedEvidenceIds: string[];
      faultAssessment: string;
    };
    verdict: {
      classification: string;
      liabilitySplit: { buyer: number; agentProvider: number; merchant: number };
      refundAmountMinor: number;
      confidence: number;
      reasoning: string;
      recommendedAction: string;
      citedEvidenceIds: string[];
    };
    policyEngine: {
      passed: boolean;
      executedAction: string;
      paypalTransactionId?: string;
      errors?: string[];
    };
  };
}

export const SEEDED_PURCHASES: MockPurchaseItem[] = [
  {
    id: "pur_demo_01",
    title: "Sony WH-1000XM5 Wireless Noise-Canceling Headphones",
    buyerId: "u_shopper_alice",
    agentId: "agent_gemini_shopper",
    merchantId: "m_tech_haven",
    state: "RESOLVED_REFUNDED_FULL",
    currency: "USD",
    amountMinor: 34999,
    capturedAmountMinor: 34999,
    refundedAmountMinor: 34999,
    paypalOrderId: "5O190127TN364715T",
    paypalAuthorizationId: "AUTH_SANDBOX_8821",
    paypalCaptureId: "CAP_SANDBOX_9912",
    paypalRefundId: "REF_SANDBOX_4401",
    createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    disputeId: "disp_demo_01",
  },
  {
    id: "pur_demo_02",
    title: "Keychron K2 Mechanical Keyboard (Hot-swappable RGB)",
    buyerId: "u_shopper_bob",
    agentId: "agent_gemini_shopper",
    merchantId: "m_peripherals_direct",
    state: "CAPTURED",
    currency: "USD",
    amountMinor: 11999,
    capturedAmountMinor: 11999,
    refundedAmountMinor: 0,
    paypalOrderId: "7K881290PX129482A",
    paypalAuthorizationId: "AUTH_SANDBOX_4412",
    paypalCaptureId: "CAP_SANDBOX_5509",
    createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
  },
  {
    id: "pur_demo_03",
    title: "Bose QuietComfort 45 Headphones (Certified Refurbished)",
    buyerId: "u_shopper_charlie",
    agentId: "agent_gemini_shopper",
    merchantId: "m_sloppy_seller",
    state: "DISPUTED",
    currency: "USD",
    amountMinor: 27999,
    capturedAmountMinor: 27999,
    refundedAmountMinor: 0,
    paypalOrderId: "2B991048NM774120C",
    paypalAuthorizationId: "AUTH_SANDBOX_3311",
    paypalCaptureId: "CAP_SANDBOX_7719",
    createdAt: new Date(Date.now() - 3600000 * 1).toISOString(),
    disputeId: "disp_demo_03",
  },
  {
    id: "pur_demo_04",
    title: "Ergonomic Mesh Office Chair with Lumbar Support",
    buyerId: "u_shopper_diana",
    agentId: "agent_gemini_shopper",
    merchantId: "m_furniture_hub",
    state: "AUTHORIZED",
    currency: "USD",
    amountMinor: 24900,
    capturedAmountMinor: 0,
    refundedAmountMinor: 0,
    paypalOrderId: "8M331920LK440192D",
    paypalAuthorizationId: "AUTH_SANDBOX_9920",
    createdAt: new Date(Date.now() - 1800000).toISOString(),
  },
  {
    id: "pur_demo_05",
    title: "SanDisk 1TB Extreme MicroSDXC Card (Fake Capacity)",
    buyerId: "u_shopper_evan",
    agentId: "agent_gemini_shopper",
    merchantId: "m_malicious_seller",
    state: "RESOLVED_REFUNDED_FULL",
    currency: "USD",
    amountMinor: 11000,
    capturedAmountMinor: 11000,
    refundedAmountMinor: 11000,
    paypalOrderId: "3F449182KL991024E",
    paypalAuthorizationId: "AUTH_SANDBOX_1209",
    paypalCaptureId: "CAP_SANDBOX_8819",
    paypalRefundId: "REF_SANDBOX_3391",
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    disputeId: "disp_demo_05",
  },
];

export const SEEDED_EVIDENCE_EVENTS: Record<string, MockEvidenceEventItem[]> = {
  pur_demo_01: [
    {
      id: "ev_pur_demo_01_1",
      purchaseId: "pur_demo_01",
      seq: 1,
      type: "INSTRUCTION_RECEIVED",
      actor: "user",
      payload: {
        prompt: "Buy Sony WH-1000XM5 wireless headphones, must be brand new in box under $360",
        budgetMinor: 36000,
        brand: "Sony",
        mustHaves: ["noise canceling", "brand new"],
        forbidden: ["refurbished", "renewed"],
      },
      createdAt: new Date(Date.now() - 7200000).toISOString(),
      prevHash: "0000000000000000000000000000000000000000000000000000000000000000",
      hash: "8a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6",
      signature: "3045022100881920abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      signerKeyId: "key_shopper_alice",
    },
    {
      id: "ev_pur_demo_01_2",
      purchaseId: "pur_demo_01",
      seq: 2,
      type: "INTENT_CHECK_RESULT",
      actor: "system",
      payload: {
        passed: true,
        score: 1.0,
        status: "PASS",
        extractedConstraints: {
          budgetMinor: 36000,
          brand: "Sony",
          forbidden: ["refurbished", "renewed"],
        },
      },
      createdAt: new Date(Date.now() - 7100000).toISOString(),
      prevHash: "8a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6",
      hash: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      signature: "3045022100994411abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      signerKeyId: "netrabox_intent_guard",
    },
    {
      id: "ev_pur_demo_01_3",
      purchaseId: "pur_demo_01",
      seq: 3,
      type: "USER_APPROVAL",
      actor: "user",
      payload: {
        approvalType: "PAYPAL_SANDBOX_OAUTH",
        userConfirmed: true,
        approvedTotalMinor: 34999,
        paypalOrderId: "5O190127TN364715T",
      },
      createdAt: new Date(Date.now() - 7000000).toISOString(),
      prevHash: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      hash: "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321",
      signature: "3045022100bbccdd1234567890abcdef1234567890abcdef1234567890abcdef123456",
      signerKeyId: "key_shopper_alice",
    },
    {
      id: "ev_pur_demo_01_4",
      purchaseId: "pur_demo_01",
      seq: 4,
      type: "PAYPAL_AUTHORIZED",
      actor: "system",
      payload: {
        paypalOrderId: "5O190127TN364715T",
        paypalAuthorizationId: "AUTH_SANDBOX_8821",
        amountMinor: 34999,
        currency: "USD",
        intent: "AUTHORIZE",
      },
      createdAt: new Date(Date.now() - 6900000).toISOString(),
      prevHash: "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321",
      hash: "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
      signature: "3045022100ddeeff1234567890abcdef1234567890abcdef1234567890abcdef123456",
      signerKeyId: "netrabox_paypal_client",
    },
    {
      id: "ev_pur_demo_01_5",
      purchaseId: "pur_demo_01",
      seq: 5,
      type: "DELIVERY_EVENT",
      actor: "merchant",
      payload: {
        trackingNumber: "TRK_FDX_884192",
        carrier: "FedEx Ground",
        deliveredAt: new Date(Date.now() - 5400000).toISOString(),
        customerPhotoAudit: "Unboxing showed brown OEM carton with Refurbished sticker",
      },
      createdAt: new Date(Date.now() - 5400000).toISOString(),
      prevHash: "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
      hash: "99887766554433221100ffeeddccbbaa99887766554433221100ffeeddccbbaa",
      signature: "30450221001122331234567890abcdef1234567890abcdef1234567890abcdef123456",
      signerKeyId: "key_tech_haven",
    },
    {
      id: "ev_pur_demo_01_6",
      purchaseId: "pur_demo_01",
      seq: 6,
      type: "PAYPAL_CAPTURED",
      actor: "system",
      payload: {
        paypalCaptureId: "CAP_SANDBOX_9912",
        amountMinor: 34999,
        finalCapture: true,
      },
      createdAt: new Date(Date.now() - 5300000).toISOString(),
      prevHash: "99887766554433221100ffeeddccbbaa99887766554433221100ffeeddccbbaa",
      hash: "3344556677889900aabbccddeeff11223344556677889900aabbccddeeff1122",
      signature: "30450221004455661234567890abcdef1234567890abcdef1234567890abcdef123456",
      signerKeyId: "netrabox_paypal_client",
    },
    {
      id: "ev_pur_demo_01_7",
      purchaseId: "pur_demo_01",
      seq: 7,
      type: "DISPUTE_OPENED",
      actor: "user",
      payload: {
        disputeId: "disp_demo_01",
        reason: "Item delivered was refurbished with scratches, violating brand new constraint",
        disputedAmountMinor: 34999,
      },
      createdAt: new Date(Date.now() - 4000000).toISOString(),
      prevHash: "3344556677889900aabbccddeeff11223344556677889900aabbccddeeff1122",
      hash: "55667788990011223344556677889900aabbccddeeff11223344556677889900",
      signature: "30450221007788991234567890abcdef1234567890abcdef1234567890abcdef123456",
      signerKeyId: "key_shopper_alice",
    },
    {
      id: "ev_pur_demo_01_8",
      purchaseId: "pur_demo_01",
      seq: 8,
      type: "TRIBUNAL_VERDICT",
      actor: "tribunal",
      payload: {
        classification: "MERCHANT_MISDESCRIBED",
        liabilitySplit: { buyer: 0, agentProvider: 0, merchant: 100 },
        refundAmountMinor: 34999,
        confidence: 0.98,
        citedEvidenceIds: ["ev_pur_demo_01_1", "ev_pur_demo_01_5"],
        reasoning:
          "Evidence event #1 explicitly commanded 'no refurbished'. Merchant listing and event #5 show refurbished goods shipped. 100% merchant liability.",
        recommendedAction: "REFUND_FULL",
      },
      createdAt: new Date(Date.now() - 3900000).toISOString(),
      prevHash: "55667788990011223344556677889900aabbccddeeff11223344556677889900",
      hash: "77889900112233445566778899001122aabbccddeeff11223344556677889900",
      signature: "30450221009900111234567890abcdef1234567890abcdef1234567890abcdef123456",
      signerKeyId: "netrabox_tribunal_judge",
    },
    {
      id: "ev_pur_demo_01_9",
      purchaseId: "pur_demo_01",
      seq: 9,
      type: "ACTION_EXECUTED",
      actor: "system",
      payload: {
        action: "RESOLVE_REFUND_FULL",
        executedActionId: "REF_SANDBOX_4401",
        refundAmountMinor: 34999,
        paypalCaptureId: "CAP_SANDBOX_9912",
        status: "COMPLETED",
      },
      createdAt: new Date(Date.now() - 3800000).toISOString(),
      prevHash: "77889900112233445566778899001122aabbccddeeff11223344556677889900",
      hash: "aabb1122334455667788990011223344aabbccddeeff11223344556677889900",
      signature: "3045022100aabbcc1234567890abcdef1234567890abcdef1234567890abcdef123456",
      signerKeyId: "netrabox_policy_engine",
    },
  ],
};

export const SEEDED_DISPUTES: Record<string, MockDisputeItem> = {
  disp_demo_01: {
    id: "disp_demo_01",
    purchaseId: "pur_demo_01",
    reason: "Item delivered was refurbished with scratches, violating brand new constraint",
    status: "RESOLVED",
    disputedAmountMinor: 34999,
    claimantActor: "user",
    createdAt: new Date(Date.now() - 4000000).toISOString(),
    resolvedAt: new Date(Date.now() - 3800000).toISOString(),
    resolutionState: "RESOLVE_REFUND_FULL",
    transcript: {
      step1Integrity: {
        passed: true,
        totalEvents: 9,
      },
      buyerBrief: {
        argument:
          "Evidence event #1 confirms user explicitly instructed: 'must be brand new in box, no refurbished'. Merchant delivery event #5 confirmed refurbished unit was delivered.",
        citedEvidenceIds: ["ev_pur_demo_01_1", "ev_pur_demo_01_5"],
        faultAssessment: "Merchant misdescribed condition; 100% merchant liability.",
      },
      merchantBrief: {
        argument:
          "Merchant shipped certified renewed inventory. Order specifications did not prevent substitution.",
        citedEvidenceIds: ["ev_pur_demo_01_5"],
        faultAssessment: "Merchant fulfilled functional audio equipment.",
      },
      verdict: {
        classification: "MERCHANT_MISDESCRIBED",
        liabilitySplit: { buyer: 0, agentProvider: 0, merchant: 100 },
        refundAmountMinor: 34999,
        confidence: 0.98,
        reasoning:
          "The Flight Recorder proves with cryptographic certainty that event #1 forbade refurbished goods. The seller shipped refurbished headphones. Full buyer refund executed.",
        recommendedAction: "REFUND_FULL",
        citedEvidenceIds: ["ev_pur_demo_01_1", "ev_pur_demo_01_5"],
      },
      policyEngine: {
        passed: true,
        executedAction: "RESOLVE_REFUND_FULL",
        paypalTransactionId: "REF_SANDBOX_4401",
      },
    },
  },
};
