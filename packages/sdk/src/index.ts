import type { AppendEvidenceInput } from "@netrabox/core";

export interface NetraBoxClientOptions {
  apiUrl: string;
  signerKeyId?: string;
  privateKeyHex?: string;
}

export class NetraBoxRecorder {
  private apiUrl: string;
  private signerKeyId: string;

  constructor(options: NetraBoxClientOptions) {
    this.apiUrl = options.apiUrl;
    this.signerKeyId = options.signerKeyId || "agent_client_key";
  }

  async recordStep(
    purchaseId: string,
    event: Omit<AppendEvidenceInput, "signerKeyId">,
  ): Promise<{ success: boolean; eventId?: string }> {
    try {
      const response = await fetch(`${this.apiUrl}/api/v1/purchases/${purchaseId}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...event,
          signerKeyId: this.signerKeyId,
        }),
      });
      if (!response.ok) {
        throw new Error(`Failed to record step: ${response.statusText}`);
      }
      const data = (await response.json()) as { id?: string };
      return { success: true, eventId: data.id };
    } catch {
      return { success: false };
    }
  }
}
