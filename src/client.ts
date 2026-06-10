import { Keypair } from '@solana/web3.js';
import axios, { type AxiosResponse } from 'axios';
import * as fs from 'fs';
import { buildExactPaymentProofJsonString, type PaymentRequiredBody } from './pr402-exact-flow.js';

export type Tier = 'hourly' | 'daily' | 'monthly';

export interface AcceptsRow {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface PaymentRequiredResponse {
  x402Version: number;
  resource: { url: string; description: string; mimeType: string };
  accepts: AcceptsRow[];
  extensions: { pr402FacilitatorUrl: string };
}

export interface SubscribeResponse {
  success: boolean;
  token: string;
  tier: Tier;
  tierLabel: string;
  expiresAt: string;
  durationSeconds: number;
  usage: string;
  persistenceHint?: string;
}

export interface SubscriptionInfo {
  tier: Tier;
  token: string;
  expiresAt: Date;
}

export interface PersistedSubscription {
  tier: Tier;
  token: string;
  expiresAt: string;
  endpointBaseUrl: string;
}

export class SubscriptionApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'SubscriptionApiError';
    this.status = status;
    this.code = code;
  }
}

const HTTP_TIMEOUT_MS = 15_000;

export class X402SubscriptionClient {
  private payer: Keypair;
  private endpointBaseUrl: string;
  private defaultFacilitatorUrl: string;
  private logger?: (message: string) => void;
  private activeSubscription: SubscriptionInfo | null = null;

  constructor(options: {
    payerKeypair: Keypair;
    endpointBaseUrl: string;
    defaultFacilitatorUrl?: string;
    logger?: (message: string) => void;
    /** Pre-load a saved JWT (e.g. after machine restart) */
    savedSubscription?: SubscriptionInfo | PersistedSubscription;
  }) {
    this.payer = options.payerKeypair;
    this.endpointBaseUrl = options.endpointBaseUrl.replace(/\/$/, '');
    this.defaultFacilitatorUrl = options.defaultFacilitatorUrl || 'https://preview.ipay.sh';
    this.logger = options.logger;

    if (options.savedSubscription) {
      const s = options.savedSubscription;
      const expiresAt = s.expiresAt instanceof Date ? s.expiresAt : new Date(s.expiresAt);
      if (expiresAt > new Date()) {
        this.activeSubscription = { tier: s.tier, token: s.token, expiresAt };
      }
    }
  }

  private log(message: string): void {
    this.logger?.(message);
  }

  public async subscribe(tier: Tier = 'hourly'): Promise<SubscriptionInfo> {
    const url = `${this.endpointBaseUrl}/api/v1/subscribe?tier=${tier}`;

    const probeRes = await axios.post(url, {}, {
      timeout: HTTP_TIMEOUT_MS,
      validateStatus: () => true,
    });

    if (probeRes.status === 200) {
      return this.storeSubscription(probeRes.data as SubscribeResponse);
    }
    if (probeRes.status !== 402) {
      throw this.apiErrorFromResponse(probeRes);
    }

    const requirements = probeRes.data as PaymentRequiredResponse;
    const paymentSignatureHeader = await buildExactPaymentProofJsonString({
      payer: this.payer,
      requirements: requirements as unknown as PaymentRequiredBody,
      defaultFacilitatorBaseUrl: this.defaultFacilitatorUrl,
      timeoutMs: HTTP_TIMEOUT_MS,
    });

    const subscribeRes = await axios.post<SubscribeResponse>(url, {}, {
      timeout: HTTP_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'PAYMENT-SIGNATURE': paymentSignatureHeader,
      },
      validateStatus: () => true,
    });

    if (subscribeRes.status !== 200) {
      throw this.apiErrorFromResponse(subscribeRes);
    }

    const data = subscribeRes.data;
    if (data.persistenceHint) {
      this.log(`Persistence: ${data.persistenceHint}`);
    }
    return this.storeSubscription(data);
  }

  public getActiveSubscription(): SubscriptionInfo | null {
    if (!this.activeSubscription) return null;
    if (this.activeSubscription.expiresAt <= new Date()) {
      this.activeSubscription = null;
      return null;
    }
    return this.activeSubscription;
  }

  /** Save JWT to disk so it survives app/machine restart (until exp). */
  public saveSubscriptionToFile(filePath: string): void {
    const sub = this.getActiveSubscription();
    if (!sub) throw new Error('No active subscription to save.');
    const payload: PersistedSubscription = {
      tier: sub.tier,
      token: sub.token,
      expiresAt: sub.expiresAt.toISOString(),
      endpointBaseUrl: this.endpointBaseUrl,
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
    this.log(`Subscription saved to ${filePath}`);
  }

  public static loadSubscriptionFromFile(filePath: string): PersistedSubscription | null {
    if (!fs.existsSync(filePath)) return null;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as PersistedSubscription;
    if (new Date(raw.expiresAt) <= new Date()) return null;
    return raw;
  }

  /** Generic protected POST — use for any seller data route. */
  public async post<T = unknown>(
    path: string,
    body: Record<string, unknown> = {},
    tier: Tier = 'hourly',
  ): Promise<T> {
    return this.requestWithToken<T>(path, body, tier);
  }

  /** Starter stub route: POST /api/v1/echo */
  public async echo(payload: Record<string, unknown> = {}, tier: Tier = 'hourly') {
    return this.post<{ payer: string; tier: Tier; echoed: unknown }>('/api/v1/echo', payload, tier);
  }

  private async requestWithToken<T>(
    path: string,
    body: Record<string, unknown>,
    tier: Tier,
  ): Promise<T> {
    if (!this.getActiveSubscription()) {
      await this.subscribe(tier);
    }

    const url = `${this.endpointBaseUrl}${path}`;
    const bearerToken = this.activeSubscription!.token;

    const res = await axios.post<T>(url, body, {
      timeout: HTTP_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bearerToken}`,
      },
      validateStatus: () => true,
    });

    if (res.status === 200) return res.data;

    if (res.status === 401) {
      const errData = res.data as { error?: string };
      if (errData.error === 'TOKEN_EXPIRED' || errData.error === 'TOKEN_REVOKED') {
        this.log(`Token ${errData.error} — renewing subscription...`);
        this.activeSubscription = null;
        await this.subscribe(tier);

        const retryRes = await axios.post<T>(url, body, {
          timeout: HTTP_TIMEOUT_MS,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.activeSubscription!.token}`,
          },
          validateStatus: () => true,
        });
        if (retryRes.status === 200) return retryRes.data;
        throw this.apiErrorFromResponse(retryRes);
      }
    }

    throw this.apiErrorFromResponse(res);
  }

  private apiErrorFromResponse(res: AxiosResponse): SubscriptionApiError {
    const data = res.data as { error?: string; message?: string } | undefined;
    return new SubscriptionApiError(
      res.status,
      data?.message || JSON.stringify(data) || `HTTP ${res.status}`,
      data?.error,
    );
  }

  private storeSubscription(data: SubscribeResponse): SubscriptionInfo {
    const info: SubscriptionInfo = {
      tier: data.tier,
      token: data.token,
      expiresAt: new Date(data.expiresAt),
    };
    this.activeSubscription = info;
    this.log(`Subscription active — tier: ${data.tier} (${data.tierLabel}), expires: ${data.expiresAt}`);
    return info;
  }
}
