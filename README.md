# x402 Subscription Client (Buyer SDK)

Generic buyer SDK for sellers using the **x402 `exact` subscription** pattern:

1. `POST /api/v1/subscribe?tier=hourly|daily|monthly` with x402 payment  
2. Receive JWT → use `Authorization: Bearer` on data routes  
3. Auto-renew on `TOKEN_EXPIRED`

Works with [x402-subscription-starter](../x402-subscription-starter/) and any compatible seller (e.g. [fifa.polystrike.io](https://fifa.polystrike.io/devnet)).

## Install

```bash
npm install x402-subscription-client
```

## Quick start

```typescript
import { Keypair } from '@solana/web3.js';
import { X402SubscriptionClient } from 'x402-subscription-client';

const client = new X402SubscriptionClient({
  payerKeypair: buyerKeypair,
  endpointBaseUrl: 'http://127.0.0.1:3000', // or https://fifa.polystrike.io/devnet
  defaultFacilitatorUrl: 'https://preview.ipay.sh',
});

await client.subscribe('hourly');

// Starter seller
const echo = await client.echo({ hello: 'world' });

// Any seller route
const data = await client.post('/api/v1/your-route', { foo: 'bar' });
```

## Save JWT across restarts

The seller issues a JWT **once per payment**. Cache it locally:

```typescript
await client.subscribe('daily');
client.saveSubscriptionToFile('./subscription-token.json');

// After restart:
const saved = X402SubscriptionClient.loadSubscriptionFromFile('./subscription-token.json');
const client = new X402SubscriptionClient({
  payerKeypair,
  endpointBaseUrl: saved!.endpointBaseUrl,
  savedSubscription: saved!,
});
await client.echo(); // reuses token — no new x402 payment until exp
```

Subscribe responses include `persistenceHint` from the seller reminding you to save the token.

## Errors

```typescript
import { SubscriptionApiError } from 'x402-subscription-client';

try {
  await client.post('/api/v1/echo');
} catch (e) {
  if (e instanceof SubscriptionApiError) {
    console.log(e.status, e.code); // 429 SUBSCRIBER_RATE_LIMIT_EXCEEDED
  }
}
```

## Docs

- [SUBSCRIPTION_PATTERN.md](../SUBSCRIPTION_PATTERN.md)
- [x402-subscription-starter](../x402-subscription-starter/) — seller reference
