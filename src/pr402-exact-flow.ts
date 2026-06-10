import { Keypair, VersionedTransaction } from '@solana/web3.js';
import {
  canonicalAcceptedForBuild,
  facilitatorBaseUrl,
  pickExactAcceptLine,
} from './pr402-defaults.js';

export type PaymentRequiredBody = {
  accepts: Array<Record<string, unknown>>;
  resource?: unknown;
  extensions?: { pr402FacilitatorUrl?: string };
};

export async function buildExactPaymentProofJsonString(args: {
  payer: Keypair;
  requirements: PaymentRequiredBody;
  defaultFacilitatorBaseUrl: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}): Promise<string> {
  const acceptLine = pickExactAcceptLine(args.requirements.accepts);
  if (!acceptLine) {
    throw new Error(
      "No supported exact rail in accepts[] (need scheme 'exact' or alias 'v2:solana:exact').",
    );
  }

  const extra = acceptLine.extra;
  const capUrl =
    extra && typeof extra === 'object' && extra !== null && 'capabilitiesUrl' in extra
      ? String((extra as { capabilitiesUrl?: string }).capabilitiesUrl ?? '')
      : '';

  const extUrl = args.requirements.extensions?.pr402FacilitatorUrl;
  const base = facilitatorBaseUrl(capUrl || extUrl || null, args.defaultFacilitatorBaseUrl);
  const accepted = canonicalAcceptedForBuild(acceptLine);
  const fetchFn = args.fetchFn ?? globalThis.fetch;
  const timeoutMs = args.timeoutMs ?? 15_000;

  const buildUrl = `${base}/api/v1/facilitator/build-exact-payment-tx`;
  const res = await fetchFn(buildUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payer: args.payer.publicKey.toBase58(),
      accepted,
      resource: args.requirements.resource,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`build-exact-payment-tx HTTP ${res.status}: ${text}`);
  }

  const buildData = JSON.parse(text) as {
    transaction: string;
    verifyBodyTemplate: { paymentPayload: { payload: { transaction?: string } } };
  };

  const txBytes = Buffer.from(buildData.transaction, 'base64');
  const vtx = VersionedTransaction.deserialize(txBytes);
  vtx.sign([args.payer]);

  const signedTxBase64 = Buffer.from(vtx.serialize()).toString('base64');
  const verifyBody = buildData.verifyBodyTemplate as {
    paymentPayload: { payload: { transaction: string } };
  };
  verifyBody.paymentPayload.payload.transaction = signedTxBase64;

  return JSON.stringify(verifyBody);
}
